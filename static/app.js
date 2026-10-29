/* =========================================================
   个人工作台 前端逻辑
   ========================================================= */
(function () {
  'use strict';

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fmtD(dateStr) {
    if (!dateStr) return '';
    const p = dateStr.split('-');
    return p[0] + '年' + Number(p[1]) + '月' + Number(p[2]) + '日';
  }
  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  }

  /* ---------- API ---------- */
  async function api(method, url, body) {
    const opt = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opt.body = JSON.stringify(body);
    const res = await fetch(url, opt);
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      if (res.status === 401) { location.reload(); return; }
      const msg = data && data.error ? data.error : ('请求失败 (' + res.status + ')');
      throw new Error(msg);
    }
    if (data && data.ok === false) throw new Error(data.error || '操作失败');
    return data;
  }

  /* ---------- 状态 ---------- */
  const state = { user: null, meetings: [], series: [], scheduleData: [], boardColumns: [] };
  const $ = (id) => document.getElementById(id);

  /* =========================================================
   * 登录 / 注册
   * ========================================================= */
  function bindAuth() {
    const tabs = document.querySelectorAll('.login-tabs .tab');
    tabs.forEach(t => t.addEventListener('click', () => {
      tabs.forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      const mode = t.dataset.tab;
      $('loginForm').style.display = mode === 'login' ? '' : 'none';
      $('registerForm').style.display = mode === 'register' ? '' : 'none';
    }));
    $('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('loginError').textContent = '';
      try {
        const data = await api('POST', '/api/auth/login', {
          username: e.target.username.value, password: e.target.password.value,
        });
        state.user = data.user; enterApp();
      } catch (ex) { $('loginError').textContent = ex.message; }
    });
    $('registerForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('registerError').textContent = '';
      try {
        const data = await api('POST', '/api/auth/register', {
          display_name: e.target.display_name.value,
          username: e.target.username.value, password: e.target.password.value,
        });
        state.user = data.user; enterApp();
      } catch (ex) { $('registerError').textContent = ex.message; }
    });
  }

  function enterApp() {
    $('loginView').style.display = 'none';
    $('appView').style.display = 'flex';
    $('avatarText').textContent = (state.user.display_name || state.user.username || '?').charAt(0);
    $('menuUsername').textContent = state.user.username;
    $('menuDisplay').textContent = state.user.display_name;
    applyLayout();
    refreshAll();
  }

  /* =========================================================
   * 头像菜单
   * ========================================================= */
  function bindAvatarMenu() {
    $('avatarBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      $('userMenu').style.display = $('userMenu').style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.topbar-user')) $('userMenu').style.display = 'none';
    });
    $('menuViewPwd').addEventListener('click', async () => {
      $('userMenu').style.display = 'none';
      try {
        const d = await api('GET', '/api/auth/password');
        openModal(`
          <h3>查看密码</h3>
          <div class="form-group"><label>当前账号</label><input type="text" value="${esc(state.user.username)}" readonly></div>
          <div class="form-group"><label>登录密码</label><input type="text" value="${esc(d.password)}" readonly></div>
          <div class="modal-actions"><button class="btn" onclick="closeModal()">关闭</button></div>
        `);
      } catch (ex) { showToast(ex.message); }
    });
    $('menuChangePwd').addEventListener('click', () => {
      $('userMenu').style.display = 'none';
      openModal(`
        <h3>修改密码</h3>
        <div class="form-group"><label>原密码</label><input type="password" id="cpOld"></div>
        <div class="form-group"><label>新密码</label><input type="password" id="cpNew" placeholder="至少4位"></div>
        <div class="form-err error" id="cpErr"></div>
        <div class="modal-actions">
          <button class="btn" onclick="closeModal()">取消</button>
          <button class="btn btn-primary" id="cpOk">保存</button>
        </div>
      `);
      $('cpOk').addEventListener('click', async () => {
        $('cpErr').textContent = '';
        try {
          await api('PUT', '/api/auth/password', { old: $('cpOld').value, new: $('cpNew').value });
          closeModal(); showToast('密码已修改');
        } catch (ex) { $('cpErr').textContent = ex.message; }
      });
    });
    $('menuLogout').addEventListener('click', async () => {
      try { await api('POST', '/api/auth/logout'); } catch (e) {}
      location.reload();
    });
  }

  /* =========================================================
   * 弹窗 / toast
   * ========================================================= */
  window.openModal = function (html) { $('modalBox').innerHTML = html; $('modalOverlay').style.display = 'flex'; };
  window.closeModal = function () { $('modalOverlay').style.display = 'none'; $('modalBox').innerHTML = ''; };
  $('modalOverlay').addEventListener('click', (e) => { if (e.target === $('modalOverlay')) closeModal(); });

  /* =========================================================
   * 布局：可拖拽分割线
   * ========================================================= */
  function applyLayout() {
    const saved = JSON.parse(localStorage.getItem('workbench-layout') || '{}');
    const topArea = $('topArea'), boardPanel = $('boardPanel');
    const meetingPanel = $('meetingPanel'), schedulePanel = $('schedulePanel');
    if (saved.topPx) { topArea.style.height = saved.topPx + 'px'; }
    if (saved.vPct != null) {
      const w = topArea.clientWidth || 800;
      meetingPanel.style.flex = '0 0 ' + Math.round(w * saved.vPct / 100) + 'px';
      schedulePanel.style.flex = '1 1 auto';
    }
  }

  function bindDividers() {
    const vd = $('vDivider'), hd = $('hDivider');
    const topArea = $('topArea'), boardPanel = $('boardPanel');
    const meetingPanel = $('meetingPanel'), schedulePanel = $('schedulePanel');

    vd.addEventListener('mousedown', (e) => {
      e.preventDefault(); vd.classList.add('dragging-v');
      const startX = e.clientX, startW = meetingPanel.clientWidth;
      function move(ev) {
        const dx = ev.clientX - startX, total = topArea.clientWidth;
        const w = Math.min(Math.max(startW + dx, 150), total - 150);
        meetingPanel.style.flex = '0 0 ' + w + 'px';
        schedulePanel.style.flex = '1 1 auto';
      }
      function up(ev) {
        move(ev); vd.classList.remove('dragging-v');
        const saved = JSON.parse(localStorage.getItem('workbench-layout') || '{}');
        saved.vPct = topArea.clientWidth ? meetingPanel.clientWidth / topArea.clientWidth : 0.5;
        localStorage.setItem('workbench-layout', JSON.stringify(saved));
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });

    hd.addEventListener('mousedown', (e) => {
      e.preventDefault(); hd.classList.add('dragging-h');
      const startY = e.clientY, startH = topArea.clientHeight;
      const maxH = document.querySelector('.workspace').clientHeight - 100;
      function move(ev) {
        const dy = ev.clientY - startY;
        const h = Math.min(Math.max(startH + dy, 150), maxH);
        topArea.style.height = h + 'px';
        boardPanel.style.flex = '1 1 auto';
      }
      function up(ev) {
        move(ev); hd.classList.remove('dragging-h');
        const saved = JSON.parse(localStorage.getItem('workbench-layout') || '{}');
        saved.topPx = topArea.clientHeight;
        localStorage.setItem('workbench-layout', JSON.stringify(saved));
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  /* =========================================================
   * 数据刷新
   * ========================================================= */
  async function refreshAll() {
    await Promise.all([loadMeetings(), loadScheduleSeries(), loadBoard(), loadScheduleWindow()]);
    renderMeetings(); renderScheduleWeek(); renderBoard();
  }
  async function loadMeetings() { const d = await api('GET', '/api/meetings'); state.meetings = d.meetings || []; }
  async function loadScheduleSeries() { const d = await api('GET', '/api/schedules/series'); state.series = d.series || []; }
  async function loadBoard() { const d = await api('GET', '/api/board'); state.boardColumns = d.columns || []; }
  async function loadScheduleWindow() {
    const r = weekRange();
    const d = await api('GET', '/api/schedules?start=' + r.start + '&end=' + r.end);
    state.scheduleData = d.schedules || [];
    renderScheduleWeek();
  }

  /* =========================================================
   * 会议纪要
   * ========================================================= */
  function renderMeetings() {
    const meetings = state.meetings;
    const thead = document.querySelector('.meeting-table thead tr');
    const body = $('meetingRows');
    const empty = $('meetingEmpty');
    const maxItems = meetings.reduce((m, x) => Math.max(m, (x.items || []).length), 1);
    let h = '<th>主题</th><th>会议时间</th><th>参会人员</th>';
    for (let k = 1; k <= maxItems; k++) {
      h += `<th>问题${k}</th><th>方案${k}</th><th>责任人${k}</th><th>是否解决${k}</th>`;
    }
    thead.innerHTML = h;
    if (!meetings.length) { body.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    body.innerHTML = meetings.map(m => {
      const dt = (m.meet_date || '') + (m.meet_time ? ' ' + m.meet_time : '');
      let cells = `<td>${esc(m.title)}</td><td>${esc(dt)}</td><td>${esc(m.participants || '')}</td>`;
      for (let k = 0; k < maxItems; k++) {
        const it = (m.items || [])[k];
        if (it) {
          const cls = it.resolved ? 'resolved-cell' : 'unresolved-cell';
          cells += `<td class="${cls}">${esc(it.problem || '')}</td>
                    <td class="${cls}">${esc(it.solution || '')}</td>
                    <td class="${cls}">${esc(it.owner || '')}</td>
                    <td class="${it.resolved ? 'ok-mark' : 'no-mark'}">${it.resolved ? '✓' : '○'}</td>`;
        } else { cells += '<td></td><td></td><td></td><td></td>'; }
      }
      return `<tr data-id="${m.id}">${cells}</tr>`;
    }).join('');
    body.querySelectorAll('tr').forEach(tr => {
      tr.addEventListener('click', () => {
        openMeetingModal(state.meetings.find(x => String(x.id) === String(tr.dataset.id)));
      });
    });
  }

  function renumberItems() {
    Array.from($('mtItems').querySelectorAll('tr')).forEach((tr, i) => { tr.children[0].textContent = i + 1; });
  }

  function openMeetingModal(meeting) {
    const isEdit = !!meeting;
    const m = meeting || { title: '', meet_date: todayStr(), meet_time: '', location: '', host: '', participants: '', items: [{ problem: '', solution: '', owner: '', resolved: false }] };
    const itemsHtml = (m.items || []).map((it, i) => `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td><input type="text" class="it-problem" value="${esc(it.problem)}"></td>
        <td><input type="text" class="it-solution" value="${esc(it.solution)}"></td>
        <td><input type="text" class="it-owner" value="${esc(it.owner)}"></td>
        <td style="text-align:center"><input type="checkbox" class="it-resolved" ${it.resolved ? 'checked' : ''}></td>
        <td style="text-align:center"><button type="button" class="del-row-btn">✕</button></td>
      </tr>`).join('');
    openModal(`
      <h3>${isEdit ? '编辑会议纪要' : '新增会议纪要'}</h3>
      <div class="form-group"><label>主题名称</label><input type="text" id="mtTitle" value="${esc(m.title)}" required></div>
      <div class="form-group"><label>会议时间</label>
        <div style="display:flex;gap:8px">
          <input type="date" id="mtDate" value="${esc(m.meet_date || todayStr())}" style="flex:1">
          <input type="time" id="mtTime" value="${esc(m.meet_time || '')}" style="flex:1">
        </div>
      </div>
      <div class="form-group"><label>地点</label><input type="text" id="mtLocation" value="${esc(m.location || '')}"></div>
      <div class="form-group"><label>主持人</label><input type="text" id="mtHost" value="${esc(m.host || '')}"></div>
      <div class="form-group"><label>参会人员</label><input type="text" id="mtParticipants" value="${esc(m.participants || '')}" placeholder="多个用、隔开"></div>
      <label>问题清单</label>
      <table class="item-table"><thead><tr><th>序号</th><th>问题</th><th>方案</th><th>责任人</th><th>是否解决</th><th></th></tr></thead>
      <tbody id="mtItems">${itemsHtml}</tbody></table>
      <button type="button" class="btn add-row-btn" id="mtAddRow">＋ 添加一行</button>
      <div class="modal-actions">
        <button class="btn" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" id="mtSave">保存</button>
      </div>
    `);
    $('mtAddRow').addEventListener('click', () => {
      const tbody = $('mtItems');
      const tr = document.createElement('tr');
      tr.innerHTML = `<td style="text-align:center">${tbody.children.length + 1}</td>
        <td><input type="text" class="it-problem"></td><td><input type="text" class="it-solution"></td>
        <td><input type="text" class="it-owner"></td>
        <td style="text-align:center"><input type="checkbox" class="it-resolved"></td>
        <td style="text-align:center"><button type="button" class="del-row-btn">✕</button></td>`;
      tr.querySelector('.del-row-btn').addEventListener('click', () => tr.remove());
      tbody.appendChild(tr); renumberItems();
    });
    $('mtItems').addEventListener('click', (e) => {
      if (e.target.classList && e.target.classList.contains('del-row-btn')) {
        e.target.closest('tr').remove(); renumberItems();
      }
    });
    $('mtSave').addEventListener('click', async () => {
      const items = Array.from($('mtItems').querySelectorAll('tr')).map((tr, i) => ({
        seq: i + 1,
        problem: tr.querySelector('.it-problem').value,
        solution: tr.querySelector('.it-solution').value,
        owner: tr.querySelector('.it-owner').value,
        resolved: tr.querySelector('.it-resolved').checked,
      }));
      const payload = {
        title: $('mtTitle').value, meet_date: $('mtDate').value, meet_time: $('mtTime').value,
        location: $('mtLocation').value, host: $('mtHost').value,
        participants: $('mtParticipants').value, items: items,
      };
      try {
        if (isEdit) await api('PUT', '/api/meetings/' + meeting.id, payload);
        else await api('POST', '/api/meetings', payload);
        closeModal(); await loadMeetings(); renderMeetings(); await loadScheduleSeries();
        showToast('已保存');
      } catch (ex) { showToast(ex.message); }
    });
  }

  $('btnNewMeeting').addEventListener('click', () => openMeetingModal(null));

  /* =========================================================
   * 日程（周视图）
   * ========================================================= */
  function weekRange() {
    const today = new Date();
    const dow = (today.getDay() + 6) % 7;
    const monday = new Date(today); monday.setDate(today.getDate() - dow);
    const end = new Date(monday); end.setDate(monday.getDate() + 20);
    const f = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return { start: f(monday), end: f(end), monday: monday };
  }

  function renderScheduleWeek() {
    const box = $('scheduleWeek');
    const data = state.scheduleData || [];
    const r = weekRange();
    const map = {};
    data.forEach(it => { (map[it.date] = map[it.date] || []).push(it); });
    const today = todayStr();
    const wdNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    let html = '<div class="sched-grid">';
    for (let w = 0; w < 3; w++) {
      const ws = new Date(r.monday); ws.setDate(ws.getDate() + w * 7);
      const we = new Date(ws); we.setDate(we.getDate() + 6);
      html += `<div class="week-row"><div class="week-label">第${w + 1}周<br>${ws.getMonth() + 1}.${ws.getDate()}—${we.getMonth() + 1}.${we.getDate()}</div>`;
      for (let d = 0; d < 7; d++) {
        const day = new Date(ws); day.setDate(ws.getDate() + d);
        const dayStr = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
        const isToday = dayStr === today;
        const items = map[dayStr] || [];
        let itemsHtml = '';
        items.forEach(it => {
          const cls = it.date < today ? 'past' : 'future';
          itemsHtml += `<div class="sched-item ${cls}" data-json="${esc(JSON.stringify(it))}">${esc(it.s_time || '')} ${esc(it.title)}</div>`;
        });
        html += `<div class="day-col ${isToday ? 'today' : ''}">
          <div class="day-head ${isToday ? 'today-head' : ''}">${wdNames[d]} ${day.getDate()}</div>${itemsHtml}</div>`;
      }
      html += '</div>';
    }
    html += '</div>';
    box.innerHTML = html;
    box.querySelectorAll('.sched-item').forEach(el => {
      el.addEventListener('click', () => openScheduleModal(JSON.parse(el.dataset.json)));
    });
  }

  function openScheduleModal(inst) {
    const series = state.series.find(s => String(s.id) === String(inst.schedule_id));
    const wdNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const meetingOpts = state.meetings.map(m => `<option value="${m.id}" ${String(m.id) === String(inst.meeting_id) ? 'selected' : ''}>${esc(m.title)}</option>`).join('');
    const isSeries = !!inst.is_series;
    const scopeHtml = isSeries ? `
      <div class="form-group"><label>修改范围</label>
        <div class="prio-radio">
          <label><input type="radio" name="scope" value="this" checked>仅本次</label>
          <label><input type="radio" name="scope" value="series">整个系列</label>
        </div>
      </div>` : '';
    const wdChecks = wdNames.map((n, i) => {
      const val = i + 1;
      const checked = isSeries && (series && series.weekdays || []).includes(val) ? 'checked' : '';
      return `<label><input type="checkbox" class="wgwd" value="${val}" ${checked}>${n}</label>`;
    }).join('');
    openModal(`
      <h3>${isSeries ? '日程详情（重复系列）' : '日程详情'}</h3>
      ${scopeHtml}
      <div class="form-group"><label>日程主题名称</label><input type="text" id="sdTitle" value="${esc(inst.title)}"></div>
      <div class="form-group"><label>日程日期</label><input type="date" id="sdDate" value="${inst.date}"></div>
      <div class="form-group"><label>日程时间（可选）</label><input type="time" id="sdTime" value="${esc(inst.s_time || '')}"></div>
      <div class="form-group"><label>关联会议纪要</label>
        <select id="sdMeeting"><option value="">（不关联）</option>${meetingOpts}</select>
      </div>
      <div id="sdWeekly" style="display:none">
        <div class="form-group"><label>每周重复日</label><div class="weekday-checks">${wdChecks}</div></div>
        <div class="form-group"><label>重复截止日期（留空=永久）</label><input type="date" id="sdUntil" value="${esc((series && series.repeat_until) || '')}"></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-danger" id="sdDel">删除</button>
        <button class="btn" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" id="sdSave">保存</button>
      </div>
    `);
    if (isSeries) {
      document.querySelectorAll('input[name=scope]').forEach(rd => {
        rd.addEventListener('change', () => {
          const seriesMode = rd.value === 'series' && rd.checked;
          $('sdWeekly').style.display = seriesMode ? 'block' : 'none';
          $('sdDate').disabled = seriesMode;
        });
      });
    }
    function currentScope() {
      const rd = document.querySelector('input[name="scope"]:checked');
      return rd ? rd.value : 'this';
    }
    $('sdSave').addEventListener('click', async () => {
      const title = $('sdTitle').value.trim();
      if (!title) { showToast('请输入日程主题'); return; }
      const meetingId = $('sdMeeting').value || null;
      try {
        if (isSeries && currentScope() === 'this') {
          await api('PUT', '/api/schedules/' + inst.schedule_id + '/occurrence', {
            occurrence_date: inst.date, title: title, s_time: $('sdTime').value, meeting_id: meetingId, action: 'edit',
          });
        } else if (isSeries) {
          const wds = Array.from($('sdWeekly').querySelectorAll('.wd:checked')).map(c => Number(c.value));
          await api('PUT', '/api/schedules/' + inst.schedule_id, {
            title, s_time: $('sdTime').value, meeting_id: meetingId,
            weekdays: wds, repeat_until: $('sdUntil').value || null,
          });
        } else {
          await api('PUT', '/api/schedules/' + inst.schedule_id, {
            title, s_date: inst.date, s_time: $('sdTime').value, meeting_id: meetingId,
          });
        }
        closeModal(); await loadScheduleSeries(); await loadScheduleWindow(); showToast('已保存');
      } catch (ex) { showToast(ex.message); }
    });
    $('sdDel').addEventListener('click', async () => {
      if (!confirm('确定删除这条日程？')) return;
      try {
        if (isSeries && currentScope() === 'this') {
          await api('PUT', '/api/schedules/' + inst.schedule_id + '/occurrence', {
            occurrence_date: inst.date, action: 'delete',
          });
        } else {
          await api('DELETE', '/api/schedules/' + inst.schedule_id);
        }
        closeModal(); await loadScheduleSeries(); await loadScheduleWindow(); showToast('已删除');
      } catch (ex) { showToast(ex.message); }
    });
  }

  $('btnNewSchedule').addEventListener('click', () => {
    const wdNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const meetingOpts = state.meetings.map(m => `<option value="${m.id}">${esc(m.title)}</option>`).join('');
    openModal(`
      <h3>创建日程</h3>
      <div class="form-group"><label>日程主题名称</label><input type="text" id="nsTitle"></div>
      <div class="form-group"><label>日期</label><input type="date" id="nsDate" value="${todayStr()}"></div>
      <div class="form-group"><label>时间（可选）</label><input type="time" id="nsTime"></div>
      <div class="form-group"><label>关联会议纪要</label>
        <select id="nsMeeting"><option value="">（不关联）</option>${meetingOpts}</select>
      </div>
      <div class="form-group"><label>重复规则</label>
        <div class="prio-radio">
          <label><input type="radio" name="nsRepeat" value="none" checked>不重复</label>
          <label><input type="radio" name="nsRepeat" value="weekly">每周重复</label>
        </div>
      </div>
      <div id="nsWeekly" style="display:none">
        <div class="form-group"><label>每周重复日</label>
          <div class="weekday-checks">${wdNames.map((n, i) => `<label><input type="checkbox" class="wd" value="${i + 1}">${n}</label>`).join('')}</div>
        </div>
        <div class="form-group"><label>重复截止日期（留空=永久）</label><input type="date" id="nsUntil"></div>
      </div>
      <div class="modal-actions"><button class="btn" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" id="nsSave">保存</button></div>
    `);
    document.querySelectorAll('input[name=nsRepeat]').forEach(rd => rd.addEventListener('change', () => {
      $('nsWeekly').style.display = rd.value === 'weekly' ? 'block' : 'none';
    }));
    $('nsSave').addEventListener('click', async () => {
      const title = $('nsTitle').value.trim();
      if (!title) { showToast('请输入日程主题'); return; }
      const repeatType = document.querySelector('input[name=nsRepeat]:checked').value;
      try {
        await api('POST', '/api/schedules', {
          title, s_date: $('nsDate').value, s_time: $('nsTime').value,
          meeting_id: $('nsMeeting').value || null, repeat_type: repeatType,
          weekdays: Array.from($('nsWeekly').querySelectorAll('.wd:checked')).map(c => Number(c.value)),
          repeat_until: $('nsUntil').value || null,
        });
        closeModal(); await loadScheduleSeries(); await loadScheduleWindow(); showToast('已创建');
      } catch (ex) { showToast(ex.message); }
    });
  });

  /* =========================================================
   * 看板
   * ========================================================= */
  function renderBoard() {
    const box = $('boardColumns');
    box.innerHTML = state.boardColumns.map(c => {
      const cardsHtml = (c.cards || []).map(card => `
        <div class="board-card" draggable="true" data-cardid="${card.id}" data-colid="${c.id}">
          <div class="card-title">${esc(card.title)}</div>
          <div class="card-meta">
            <span class="prio-dot prio-${esc(card.priority)}"></span>
            ${card.due_date ? '<span>📅 ' + esc(fmtD(card.due_date)) + '</span>' : ''}
            ${card.subtasks && card.subtasks.length ? '<span>☑ ' + card.subtasks.filter(s => s.done).length + '/' + card.subtasks.length + '</span>' : ''}
          </div>
        </div>`).join('');
      return `
        <div class="board-col" data-colid="${c.id}">
          <div class="board-col-head" draggable="true">
            <span class="col-title">${esc(c.title)}</span>
            <span class="col-actions">
              <button class="icon-btn" data-act="edit-col" title="重命名">✎</button>
              <button class="icon-btn" data-act="del-col" title="删除列表">✕</button>
            </span>
          </div>
          <div class="board-cards" data-dropcol="${c.id}">${cardsHtml}</div>
          <button class="add-card-btn" data-addcol="${c.id}">＋ 新增任务</button>
        </div>`;
    }).join('');

    box.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const col = state.boardColumns.find(x => String(x.id) === String(btn.closest('.board-col').dataset.colid));
        if (btn.dataset.act === 'edit-col') {
          const name = prompt('重命名列表', col.title);
          if (name !== null && name.trim()) {
            await api('PUT', '/api/board/columns/' + col.id, { title: name.trim() });
            await loadBoard(); renderBoard();
          }
        } else if (btn.dataset.act === 'del-col') {
          if (confirm('确定删除该列表（含其中所有任务）？')) {
            await api('DELETE', '/api/board/columns/' + col.id);
            await loadBoard(); renderBoard();
          }
        }
      });
    });
    box.querySelectorAll('[data-addcol]').forEach(btn => {
      btn.addEventListener('click', () => openCardModal(null, Number(btn.dataset.addcol)));
    });
    // 卡片拖拽
    box.querySelectorAll('.board-card').forEach(card => {
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', card.dataset.cardid);
        card.classList.add('card-dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('card-dragging'));
    });
    box.querySelectorAll('.board-cards').forEach(colBody => {
      colBody.addEventListener('dragover', (e) => e.preventDefault());
      colBody.addEventListener('drop', async (e) => {
        e.preventDefault();
        const cardId = e.dataTransfer.getData('text/plain');
        const newColId = Number(colBody.dataset.dropcol);
        try {
          await api('PUT', '/api/board/cards/' + cardId, { column_id: newColId });
          await loadBoard(); renderBoard();
        } catch (ex) { showToast(ex.message); }
      });
    });
    // 列拖拽换序
    box.querySelectorAll('.board-col-head').forEach(head => {
      head.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('colmove', head.closest('.board-col').dataset.colid);
      });
      head.addEventListener('dragover', (e) => e.preventDefault());
      head.addEventListener('drop', async (e) => {
        e.preventDefault();
        const srcId = e.dataTransfer.getData('colmove');
        const dstId = head.closest('.board-col').dataset.colid;
        if (!srcId || srcId === dstId) return;
        const ids = state.boardColumns.map(c => String(c.id));
        const si = ids.indexOf(srcId), di = ids.indexOf(dstId);
        ids.splice(si, 1); ids.splice(di, 0, srcId);
        for (let i = 0; i < ids.length; i++) {
          await api('PUT', '/api/board/columns/' + ids[i], { sort_order: i });
        }
        await loadBoard(); renderBoard();
      });
    });
  }

  function addSubRow(container, content, done) {
    const row = document.createElement('div');
    row.className = 'subtask-row';
    row.innerHTML = `<input type="checkbox" class="st-done" ${done ? 'checked' : ''}>
      <input type="text" class="st-content" value="${esc(content || '')}">
      <button type="button" class="del-st">✕</button>`;
    const cb = row.querySelector('.st-done');
    const inp = row.querySelector('.st-content');
    cb.addEventListener('change', () => inp.classList.toggle('subtask-done', cb.checked));
    row.querySelector('.del-st').addEventListener('click', () => row.remove());
    container.appendChild(row);
    if (done) inp.classList.add('subtask-done');
    return row;
  }

  function openCardModal(card, columnId) {
    const isEdit = !!card;
    const c = card || { title: '', due_date: '', priority: 'medium', subtasks: [] };
    openModal(`
      <h3>${isEdit ? '编辑任务卡片' : '新增任务卡片'}</h3>
      <div class="form-group"><label>事项名称</label><input type="text" id="cdTitle" value="${esc(c.title)}" required></div>
      <div class="form-group"><label>到期日</label><input type="date" id="cdDue" value="${esc(c.due_date || '')}"></div>
      <div class="form-group"><label>优先级</label>
        <div class="prio-radio">
          <label><input type="radio" name="cdPrio" value="high" ${c.priority === 'high' ? 'checked' : ''}>高</label>
          <label><input type="radio" name="cdPrio" value="medium" ${c.priority === 'medium' ? 'checked' : ''}>中</label>
          <label><input type="radio" name="cdPrio" value="low" ${c.priority === 'low' ? 'checked' : ''}>低</label>
        </div>
      </div>
      <label>子任务（勾选完成即画删除线）</label>
      <div id="cdSubs"></div>
      <button type="button" class="btn add-row-btn" id="cdAddSub">＋ 添加子任务</button>
      <div class="modal-actions">
        ${isEdit ? '<button class="btn btn-danger" id="cdDel">删除卡片</button>' : ''}
        <button class="btn" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" id="cdSave">保存</button>
      </div>
    `);
    const subBox = $('cdSubs');
    (c.subtasks || []).forEach(st => addSubRow(subBox, st.content, st.done));
    $('cdAddSub').addEventListener('click', () => addSubRow(subBox, '', false));
    $('cdSave').addEventListener('click', async () => {
      const title = $('cdTitle').value.trim();
      if (!title) { showToast('请输入事项名称'); return; }
      const subtasks = Array.from($('cdSubs').querySelectorAll('.subtask-row')).map(row => ({
        content: row.querySelector('.st-content').value,
        done: row.querySelector('.st-done').checked,
      }));
      const payload = {
        title, due_date: $('cdDue').value || null,
        priority: document.querySelector('input[name=cdPrio]:checked').value,
        subtasks: subtasks, column_id: columnId,
      };
      try {
        if (isEdit) {
          await api('PUT', '/api/board/cards/' + card.id, payload);
        } else {
          const created = await api('POST', '/api/board/cards', { column_id: columnId, title: title, due_date: payload.due_date, priority: payload.priority });
          await api('PUT', '/api/board/cards/' + created.card.id, payload);
        }
        closeModal(); await loadBoard(); renderBoard(); showToast('已保存');
      } catch (ex) { showToast(ex.message); }
    });
    if (isEdit) {
      $('cdDel').addEventListener('click', async () => {
        if (!confirm('确定删除该卡片？')) return;
        await api('DELETE', '/api/board/cards/' + card.id);
        closeModal(); await loadBoard(); renderBoard(); showToast('已删除');
      });
    }
  }

  function initCardClick() {
    $('boardColumns').addEventListener('click', (e) => {
      const cardEl = e.target.closest('.board-card');
      if (cardEl) {
        const colId = Number(cardEl.dataset.colid);
        const col = state.boardColumns.find(x => x.id === colId);
        const cardObj = col && col.cards.find(cc => String(cc.id) === String(cardEl.dataset.cardid));
        if (cardObj) openCardModal(cardObj, colId);
      }
    });
  }

  /* =========================================================
   * 启动
   * ========================================================= */
  $('btnNewColumn').addEventListener('click', async () => {
    const name = prompt('请输入新列表名称', '新列表');
    if (name === null || !name.trim()) return;
    try {
      await api('POST', '/api/board/columns', { title: name.trim() });
      await loadBoard(); renderBoard();
    } catch (ex) { showToast(ex.message); }
  });

  async function boot() {
    bindAuth(); bindAvatarMenu(); bindDividers(); initCardClick();
    try {
      const d = await api('GET', '/api/auth/me');
      state.user = d.user; enterApp();
    } catch (e) {
      $('loginView').style.display = 'flex';
      $('appView').style.display = 'none';
    }
  }
  boot();
})();