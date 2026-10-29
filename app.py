# -*- coding: utf-8 -*-
"""
个人工作台 - Flask 后端
单页应用：会议纪要 + 周视图日程 + 看板任务
数据库：本地开发用 SQLite，生产用 PostgreSQL（DATABASE_URL 环境变量）
"""
import os
import json
from datetime import date, datetime, timedelta
from functools import wraps

from flask import (Flask, request, jsonify, session, render_template)
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash

# ---------------------------------------------------------------------------
# 应用与数据库初始化
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder='static', template_folder='templates')
app.secret_key = os.environ.get('SECRET_KEY', 'gongzuotai-dev-secret-2026')

DATABASE_URL = os.environ.get('DATABASE_URL')
if DATABASE_URL:
    app.config['SQLALCHEMY_DATABASE_URI'] = DATABASE_URL
else:
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(BASE_DIR, 'dev.db')

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['JSON_AS_ASCII'] = False
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)

db = SQLAlchemy(app)


# ---------------------------------------------------------------------------
# 数据模型
# ---------------------------------------------------------------------------
class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)  # 登录账号
    display_name = db.Column(db.String(80), nullable=False)            # 显示姓名
    password_hash = db.Column(db.String(256), nullable=False)
    password_plain = db.Column(db.String(256), nullable=True)  # 明文，供"查看密码"功能展示（内部工具）
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Meeting(db.Model):
    """会议纪要"""
    __tablename__ = 'meetings'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    title = db.Column(db.String(200), nullable=False)       # 主题
    meet_date = db.Column(db.String(20), nullable=True)     # 会议时间(日期) YYYY-MM-DD
    meet_time = db.Column(db.String(20), nullable=True)     # 会议时间(时刻) HH:MM
    location = db.Column(db.String(200), nullable=True)     # 地点
    host = db.Column(db.String(100), nullable=True)         # 主持人
    participants = db.Column(db.String(300), nullable=True) # 参会人员
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    items = db.relationship('MeetingItem', backref='meeting', lazy='joined',
                            order_by='MeetingItem.seq', cascade='all, delete-orphan')


class MeetingItem(db.Model):
    """会议纪要 - 问题清单（序号/问题/方案/责任人/是否解决）"""
    __tablename__ = 'meeting_items'
    id = db.Column(db.Integer, primary_key=True)
    meeting_id = db.Column(db.Integer, db.ForeignKey('meetings.id'), nullable=False)
    seq = db.Column(db.Integer, nullable=False, default=1)
    problem = db.Column(db.String(500), nullable=True)
    solution = db.Column(db.String(500), nullable=True)
    owner = db.Column(db.String(100), nullable=True)
    resolved = db.Column(db.Boolean, default=False)


class Schedule(db.Model):
    """日程。单次日程 is_series=False；重复日程 is_series=True（代表整个系列）"""
    __tablename__ = 'schedules'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    title = db.Column(db.String(200), nullable=False)       # 日程主体名称
    s_date = db.Column(db.String(20), nullable=True)        # 日期 YYYY-MM-DD（重复系列为起始日）
    s_time = db.Column(db.String(20), nullable=True)        # 时间 HH:MM
    repeat_type = db.Column(db.String(20), default='none')  # none / weekly
    weekdays = db.Column(db.String(100), nullable=True)     # 每周重复的星期，如 "1,3"（周一=1）
    repeat_until = db.Column(db.String(20), nullable=True)  # 重复截止日期，空=永久
    is_series = db.Column(db.Boolean, default=False)        # 是否为重复系列
    meeting_id = db.Column(db.Integer, db.ForeignKey('meetings.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    overrides = db.relationship('ScheduleOverride', backref='schedule',
                                cascade='all, delete-orphan')


class ScheduleOverride(db.Model):
    """重复日程的单个实例覆盖（仅本次修改/删除）"""
    __tablename__ = 'schedule_overrides'
    id = db.Column(db.Integer, primary_key=True)
    schedule_id = db.Column(db.Integer, db.ForeignKey('schedules.id'), nullable=False)
    occurrence_date = db.Column(db.String(20), nullable=False)  # 发生日期
    title = db.Column(db.String(200), nullable=True)
    s_time = db.Column(db.String(20), nullable=True)
    meeting_id = db.Column(db.Integer, nullable=True)
    deleted = db.Column(db.Boolean, default=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class KanbanColumn(db.Model):
    """看板列"""
    __tablename__ = 'kanban_columns'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    sort_order = db.Column(db.Integer, default=0)
    cards = db.relationship('KanbanCard', backref='column',
                            cascade='all, delete-orphan', order_by='KanbanCard.sort_order')


class KanbanCard(db.Model):
    """看板任务卡片"""
    __tablename__ = 'kanban_cards'
    id = db.Column(db.Integer, primary_key=True)
    column_id = db.Column(db.Integer, db.ForeignKey('kanban_columns.id'), nullable=False)
    title = db.Column(db.String(300), nullable=False)     # 事项名称
    due_date = db.Column(db.String(20), nullable=True)    # 到期日
    priority = db.Column(db.String(20), default='medium') # high/medium/low
    sort_order = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    subtasks = db.relationship('CardSubtask', backref='card',
                               cascade='all, delete-orphan', order_by='CardSubtask.sort_order')


class CardSubtask(db.Model):
    """任务卡片子任务"""
    __tablename__ = 'card_subtasks'
    id = db.Column(db.Integer, primary_key=True)
    card_id = db.Column(db.Integer, db.ForeignKey('kanban_cards.id'), nullable=False)
    content = db.Column(db.String(300), nullable=True)
    done = db.Column(db.Boolean, default=False)
    sort_order = db.Column(db.Integer, default=0)


# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------
def current_user():
    uid = session.get('uid')
    if not uid:
        return None
    return User.query.get(uid)


def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not current_user():
            return jsonify({'ok': False, 'error': '未登录'}), 401
        return f(*args, **kwargs)
    return wrapper


def to_meeting(m):
    return {
        'id': m.id,
        'title': m.title,
        'meet_date': m.meet_date,
        'meet_time': m.meet_time,
        'location': m.location,
        'host': m.host,
        'participants': m.participants,
        'created_at': m.created_at.isoformat() if m.created_at else None,
        'items': [
            {'seq': it.seq, 'problem': it.problem, 'solution': it.solution,
             'owner': it.owner, 'resolved': it.resolved}
            for it in m.items
        ],
    }


def parse_weekdays(s):
    """'1,3' -> [1,3]（周一=1）"""
    if not s:
        return []
    try:
        return [int(x) for x in str(s).split(',') if x.strip() != '']
    except (ValueError, TypeError):
        return []


def sched_to_base(s):
    return {
        'id': s.id,
        'title': s.title,
        's_date': s.s_date,
        's_time': s.s_time,
        'repeat_type': s.repeat_type,
        'weekdays': parse_weekdays(s.weekdays),
        'repeat_until': s.repeat_until,
        'is_series': s.is_series,
        'meeting_id': s.meeting_id,
    }


def iter_dates(start, end):
    d = datetime.strptime(start, '%Y-%m-%d').date()
    endd = datetime.strptime(end, '%Y-%m-%d').date()
    while d <= endd:
        yield d
        d += timedelta(days=1)


def schedule_occurrences(s, start, end):
    """
    返回该日程在 [start,end] 窗口内的具体实例列表（每条 instance 含具体 date 与是否被覆盖）。
    - 单条日程（非重复）：命中窗口才返回
    - 重复系列：按周规律计算窗口内命中日，叠加 override
    """
    out = []
    if not s.is_series:
        if s.s_date and start <= s.s_date <= end:
            out.append({
                'schedule_id': s.id,
                'is_series': False,
                'date': s.s_date,
                'title': s.title,
                's_time': s.s_time,
                'meeting_id': s.meeting_id,
                'overridden': False,
            })
        return out

    # 重复系列
    weekdays = parse_weekdays(s.weekdays)
    if not weekdays:
        return out
    overrides = {o.occurrence_date: o for o in s.overrides}
    for d in iter_dates(start, end):
        if s.repeat_until and d > datetime.strptime(s.repeat_until, '%Y-%m-%d').date():
            break
        if s.s_date and d < datetime.strptime(s.s_date, '%Y-%m-%d').date():
            continue
        if d.isoweekday() not in weekdays:
            continue
        od = d.strftime('%Y-%m-%d')
        ov = overrides.get(od)
        if ov and ov.deleted:
            continue
        out.append({
            'schedule_id': s.id,
            'is_series': True,
            'date': od,
            'title': ov.title if ov and ov.title else s.title,
            's_time': ov.s_time if ov and ov.s_time is not None else s.s_time,
            'meeting_id': ov.meeting_id if ov and ov.meeting_id is not None else s.meeting_id,
            'overridden': bool(ov),
        })
    return out


# ---------------------------------------------------------------------------
# 页面
# ---------------------------------------------------------------------------
@app.route('/')
def index():
    return render_template('index.html')


@app.route('/init')
def init_db():
    db.create_all()
    return jsonify({'ok': True, 'message': '数据库初始化完成'})


# ---------------------------------------------------------------------------
# 账号相关 API
# ---------------------------------------------------------------------------
@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json(force=True) or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    display_name = (data.get('display_name') or '').strip() or username
    if not username or not password:
        return jsonify({'ok': False, 'error': '账号和密码必填'}), 400
    if len(password) < 4:
        return jsonify({'ok': False, 'error': '密码至少4位'}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({'ok': False, 'error': '该账号已存在'}), 400
    u = User(username=username, display_name=display_name,
             password_hash=generate_password_hash(password),
             password_plain=password)
    db.session.add(u)
    db.session.flush()
    # 新建用户预置3个看板列
    for i, t in enumerate(['待办', '进行中', '已完成']):
        db.session.add(KanbanColumn(user_id=u.id, title=t, sort_order=i))
    db.session.commit()
    session['uid'] = u.id
    return jsonify({'ok': True, 'user': {'id': u.id, 'username': u.username,
                                          'display_name': u.display_name}})


@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json(force=True) or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    u = User.query.filter_by(username=username).first()
    if not u or not check_password_hash(u.password_hash, password):
        return jsonify({'ok': False, 'error': '账号或密码错误'}), 401
    session['uid'] = u.id
    return jsonify({'ok': True, 'user': {'id': u.id, 'username': u.username,
                                          'display_name': u.display_name}})


@app.route('/api/auth/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'ok': True})


@app.route('/api/auth/me', methods=['GET'])
def me():
    u = current_user()
    if not u:
        return jsonify({'ok': False}), 401
    return jsonify({'ok': True, 'user': {'id': u.id, 'username': u.username,
                                          'display_name': u.display_name,
                                          'password': u.password_hash}})


@app.route('/api/auth/password', methods=['PUT'])
def change_password():
    u = current_user()
    if not u:
        return jsonify({'ok': False, 'error': '未登录'}), 401
    data = request.get_json(force=True) or {}
    old = data.get('old') or ''
    new = data.get('new') or ''
    if not check_password_hash(u.password_hash, old):
        return jsonify({'ok': False, 'error': '原密码错误'}), 400
    if len(new) < 4:
        return jsonify({'ok': False, 'error': '新密码至少4位'}), 400
    u.password_hash = generate_password_hash(new)
    u.password_plain = new
    db.session.commit()
    return jsonify({'ok': True})


@app.route('/api/auth/password', methods=['GET'])
@login_required
def get_password():
    """查看密码：返回当前账号的明文密码（内部工具需求）"""
    u = current_user()
    return jsonify({'ok': True, 'password': u.password_plain or ''})


# ---------------------------------------------------------------------------
# 会议纪要 API
# ---------------------------------------------------------------------------
@app.route('/api/meetings', methods=['GET'])
@login_required
def list_meetings():
    u = current_user()
    ms = Meeting.query.filter_by(user_id=u.id).order_by(Meeting.created_at.desc()).all()
    return jsonify({'ok': True, 'meetings': [to_meeting(m) for m in ms]})


@app.route('/api/meetings', methods=['POST'])
@login_required
def create_meeting():
    u = current_user()
    data = request.get_json(force=True) or {}
    m = Meeting(
        user_id=u.id,
        title=(data.get('title') or '').strip() or '未命名会议',
        meet_date=data.get('meet_date'),
        meet_time=data.get('meet_time'),
        location=data.get('location'),
        host=data.get('host'),
        participants=data.get('participants'),
    )
    db.session.add(m)
    db.session.flush()  # 先生成 m.id，供问题清单外键使用
    _set_meeting_items(m, data.get('items'))
    db.session.commit()
    return jsonify({'ok': True, 'meeting': to_meeting(m)})


@app.route('/api/meetings/<int:mid>', methods=['PUT'])
@login_required
def update_meeting(mid):
    u = current_user()
    m = Meeting.query.filter_by(id=mid, user_id=u.id).first()
    if not m:
        return jsonify({'ok': False, 'error': '纪要不存在'}), 404
    data = request.get_json(force=True) or {}
    m.title = (data.get('title') or '').strip() or m.title
    m.meet_date = data.get('meet_date', m.meet_date)
    m.meet_time = data.get('meet_time', m.meet_time)
    m.location = data.get('location', m.location)
    m.host = data.get('host', m.host)
    m.participants = data.get('participants', m.participants)
    # 重建问题清单
    MeetingItem.query.filter_by(meeting_id=m.id).delete()
    db.session.flush()
    _set_meeting_items(m, data.get('items'))
    db.session.commit()
    return jsonify({'ok': True, 'meeting': to_meeting(m)})


def _set_meeting_items(m, items):
    for i, it in enumerate(items or []):
        db.session.add(MeetingItem(
            meeting_id=m.id, seq=i + 1,
            problem=(it.get('problem') or ''),
            solution=(it.get('solution') or ''),
            owner=(it.get('owner') or ''),
            resolved=bool(it.get('resolved')),
        ))


@app.route('/api/meetings/<int:mid>', methods=['DELETE'])
@login_required
def delete_meeting(mid):
    u = current_user()
    m = Meeting.query.filter_by(id=mid, user_id=u.id).first()
    if not m:
        return jsonify({'ok': False, 'error': '纪要不存在'}), 404
    # 解除关联日程的绑定
    Schedule.query.filter_by(user_id=u.id, meeting_id=m.id).update({'meeting_id': None})
    db.session.delete(m)
    db.session.commit()
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# 日程 API
# ---------------------------------------------------------------------------
@app.route('/api/schedules', methods=['GET'])
@login_required
def list_schedules():
    u = current_user()
    start = request.args.get('start')
    end = request.args.get('end')
    if not start or not end:
        today = date.today()
        start = (today - timedelta(days=7)).strftime('%Y-%m-%d')
        end = (today + timedelta(days=21)).strftime('%Y-%m-%d')
    ss = Schedule.query.filter_by(user_id=u.id).all()
    out = []
    for s in ss:
        out.extend(schedule_occurrences(s, start, end))
    out.sort(key=lambda x: (x['date'], x.get('s_time') or ''))
    return jsonify({'ok': True, 'schedules': out})


@app.route('/api/schedules/series', methods=['GET'])
@login_required
def list_schedule_series():
    """返回所有日程（含系列定义），供编辑/删除时使用"""
    u = current_user()
    ss = Schedule.query.filter_by(user_id=u.id).order_by(Schedule.created_at.desc()).all()
    return jsonify({'ok': True, 'series': [parse_to_base(s) for s in ss]})


def parse_to_base(s):
    return {
        'id': s.id,
        'title': s.title,
        's_date': s.s_date,
        's_time': s.s_time,
        'repeat_type': s.repeat_type,
        'weekdays': parse_weekdays(s.weekdays),
        'repeat_until': s.repeat_until,
        'is_series': s.is_series,
        'meeting_id': s.meeting_id,
    }


@app.route('/api/schedules', methods=['POST'])
@login_required
def create_schedule():
    u = current_user()
    data = request.get_json(force=True) or {}
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'ok': False, 'error': '日程主题必填'}), 400
    repeat_type = data.get('repeat_type') or 'none'
    s = Schedule(
        user_id=u.id,
        title=title,
        s_date=data.get('s_date'),
        s_time=data.get('s_time'),
        repeat_type=repeat_type,
        weekdays=','.join(str(x) for x in (data.get('weekdays') or [])),
        repeat_until=data.get('repeat_until') or None,
        is_series=(repeat_type == 'weekly'),
        meeting_id=data.get('meeting_id') or None,
    )
    db.session.add(s)
    db.session.commit()
    return jsonify({'ok': True, 'schedule': parse_to_base(s)})


@app.route('/api/schedules/<int:sid>', methods=['PUT'])
@login_required
def update_schedule(sid):
    """编辑整个系列/单条日程。repeat_until 传空表示保留原值。"""
    u = current_user()
    s = Schedule.query.filter_by(id=sid, user_id=u.id).first()
    if not s:
        return jsonify({'ok': False, 'error': '日程不存在'}), 404
    data = request.get_json(force=True) or {}
    s.title = (data.get('title') or '').strip() or s.title
    s.s_time = data.get('s_time', s.s_time)
    s.meeting_id = data.get('meeting_id') if data.get('meeting_id') is not None else s.meeting_id
    if s.is_series:
        s.repeat_type = 'weekly'
        s.weekdays = ','.join(str(x) for x in (data.get('weekdays') or parse_weekdays(s.weekdays)))
        ru = data.get('repeat_until')
        if ru is not None:
            s.repeat_until = ru or None
        # 整个系列修改 -> 清除所有覆盖
        ScheduleOverride.query.filter_by(schedule_id=s.id).delete()
    else:
        if data.get('s_date') is not None:
            s.s_date = data.get('s_date')
        s.repeat_type = 'none'
    db.session.commit()
    return jsonify({'ok': True, 'schedule': parse_to_base(s)})


@app.route('/api/schedules/<int:sid>', methods=['DELETE'])
@login_required
def delete_schedule(sid):
    """删除整个系列或单条日程"""
    u = current_user()
    s = Schedule.query.filter_by(id=sid, user_id=u.id).first()
    if not s:
        return jsonify({'ok': False, 'error': '日程不存在'}), 404
    db.session.delete(s)
    db.session.commit()
    return jsonify({'ok': True})


@app.route('/api/schedules/<int:sid>/occurrence', methods=['PUT'])
@login_required
def edit_occurrence(sid):
    """编辑/删除重复日程的单个实例（仅本次）。"""
    u = current_user()
    s = Schedule.query.filter_by(id=sid, user_id=u.id).first()
    if not s:
        return jsonify({'ok': False, 'error': '日程不存在'}), 404
    data = request.get_json(force=True) or {}
    occurrence = data.get('occurrence_date')
    if not occurrence:
        return jsonify({'ok': False, 'error': '缺少日期'}), 400
    action = data.get('action') or 'edit'  # edit / delete
    ov = ScheduleOverride.query.filter_by(schedule_id=sid, occurrence_date=occurrence).first()
    if not ov:
        ov = ScheduleOverride(schedule_id=sid, occurrence_date=occurrence)
        db.session.add(ov)
    if action == 'delete':
        ov.deleted = True
    else:
        ov.deleted = False
        ov.title = (data.get('title') or '').strip() or None
        ov.s_time = data.get('s_time')
        ov.meeting_id = data.get('meeting_id')
    db.session.commit()
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# 看板 API
# ---------------------------------------------------------------------------
@app.route('/api/board', methods=['GET'])
@login_required
def get_board():
    u = current_user()
    cols = KanbanColumn.query.filter_by(user_id=u.id).order_by(KanbanColumn.sort_order).all()
    result = []
    for c in cols:
        result.append({
            'id': c.id,
            'title': c.title,
            'sort_order': c.sort_order,
            'cards': [
                {'id': card.id, 'title': card.title, 'due_date': card.due_date,
                 'priority': card.priority, 'sort_order': card.sort_order,
                 'subtasks': [{'id': st.id, 'content': st.content, 'done': st.done,
                               'sort_order': st.sort_order} for st in card.subtasks]}
                for card in c.cards
            ],
        })
    return jsonify({'ok': True, 'columns': result})


@app.route('/api/board/columns', methods=['POST'])
@login_required
def add_column():
    u = current_user()
    data = request.get_json(force=True) or {}
    title = (data.get('title') or '').strip() or '新列表'
    mx = db.session.query(db.func.max(KanbanColumn.sort_order)).filter_by(user_id=u.id).scalar() or 0
    c = KanbanColumn(user_id=u.id, title=title, sort_order=mx + 1)
    db.session.add(c)
    db.session.commit()
    return jsonify({'ok': True, 'column': {'id': c.id, 'title': c.title, 'cards': []}})


@app.route('/api/board/columns/<int:cid>', methods=['PUT'])
@login_required
def update_column(cid):
    u = current_user()
    c = KanbanColumn.query.filter_by(id=cid, user_id=u.id).first()
    if not c:
        return jsonify({'ok': False, 'error': '看板列不存在'}), 404
    data = request.get_json(force=True) or {}
    if data.get('title') is not None:
        c.title = (data.get('title') or '').strip()
    if data.get('sort_order') is not None:
        c.sort_order = int(data['sort_order'])
    db.session.commit()
    return jsonify({'ok': True})


@app.route('/api/board/columns/<int:cid>', methods=['DELETE'])
@login_required
def delete_column(cid):
    u = current_user()
    c = KanbanColumn.query.filter_by(id=cid, user_id=u.id).first()
    if not c:
        return jsonify({'ok': False, 'error': '看板列不存在'}), 404
    db.session.delete(c)
    db.session.commit()
    return jsonify({'ok': True})


@app.route('/api/board/cards', methods=['POST'])
@login_required
def add_card():
    u = current_user()
    data = request.get_json(force=True) or {}
    col = KanbanColumn.query.filter_by(id=data.get('column_id'), user_id=u.id).first()
    if not col:
        return jsonify({'ok': False, 'error': '看板列不存在'}), 404
    mx = db.session.query(db.func.max(KanbanCard.sort_order)).filter_by(column_id=col.id).scalar() or 0
    card = KanbanCard(column_id=col.id,
                      title=(data.get('title') or '').strip() or '新任务',
                      due_date=data.get('due_date'),
                      priority=data.get('priority') or 'medium',
                      sort_order=mx + 1)
    db.session.add(card)
    db.session.commit()
    return jsonify({'ok': True, 'card': {'id': card.id, 'title': card.title,
                                          'due_date': card.due_date, 'priority': card.priority,
                                          'subtasks': []}})


@app.route('/api/board/cards/<int:card_id>', methods=['PUT'])
@login_required
def update_card(card_id):
    u = current_user()
    card = KanbanCard.query.filter_by(id=card_id).join(KanbanColumn).filter(KanbanColumn.user_id == u.id).first()
    if not card:
        return jsonify({'ok': False, 'error': '卡片不存在'}), 404
    data = request.get_json(force=True) or {}
    if data.get('title') is not None:
        card.title = (data.get('title') or '').strip()
    if data.get('due_date') is not None:
        card.due_date = data.get('due_date')
    if data.get('priority') is not None:
        card.priority = data.get('priority')
    if data.get('column_id') is not None:
        nc = KanbanColumn.query.filter_by(id=data['column_id'], user_id=u.id).first()
        if nc:
            card.column_id = nc.id
    # 子任务
    if data.get('subtasks') is not None:
        CardSubtask.query.filter_by(card_id=card.id).delete()
        db.session.flush()
        for i, st in enumerate(data['subtasks']):
            db.session.add(CardSubtask(card_id=card.id, content=(st.get('content') or ''),
                                       done=bool(st.get('done')), sort_order=i))
    db.session.commit()
    return jsonify({'ok': True})


@app.route('/api/board/cards/<int:card_id>', methods=['DELETE'])
@login_required
def delete_card(card_id):
    u = current_user()
    card = KanbanCard.query.filter_by(id=card_id).join(KanbanColumn).filter(KanbanColumn.user_id == u.id).first()
    if not card:
        return jsonify({'ok': False, 'error': '卡片不存在'}), 404
    db.session.delete(card)
    db.session.commit()
    return jsonify({'ok': True})


# 应用模块被导入时自动建表（幂等），保证 gunicorn 部署无需手动 /init
with app.app_context():
    db.create_all()


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)