// Tibo's macOS actions for workflows: osascript -l JavaScript mac.js <command> [args...]
// Values arrive as argv, never spliced into code, so user text can't break out of a string.
// Dates are local "YYYY-MM-DDTHH:MM". Output is plain text lines for the agent to read.
ObjC.import('Foundation');

function when(text) {
  const date = new Date(text);
  if (isNaN(date)) throw new Error(`Ngày giờ không hợp lệ: ${text} (cần YYYY-MM-DDTHH:MM)`);
  return date;
}

function stamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dayRange(days) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return [start, new Date(start.getTime() + Number(days || 1) * 864e5)];
}

// One single-quoted shell word.
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

const app = Application.currentApplication();
app.includeStandardAdditions = true;

const commands = {
  // reminders-add <title> [when]
  'reminders-add'(title, due) {
    const Reminders = Application('Reminders');
    const props = { name: title };
    if (due) props.remindMeDate = when(due);
    Reminders.defaultList().reminders.push(Reminders.Reminder(props));
    return `Đã tạo nhắc việc: ${title}${due ? ' lúc ' + stamp(props.remindMeDate) : ''}`;
  },
  // reminders-list: unfinished reminders, due ones first
  'reminders-list'() {
    const items = Application('Reminders').reminders.whose({ completed: false })();
    const rows = items.slice(0, 40).map((r) => ({ name: r.name(), due: r.remindMeDate() }));
    rows.sort((a, b) => (a.due ? a.due.getTime() : Infinity) - (b.due ? b.due.getTime() : Infinity));
    return rows.map((r) => `${r.due ? stamp(r.due) : 'không hạn'} | ${r.name}`).join('\n') || 'Không có nhắc việc nào.';
  },
  // calendar-list [days=1]: events from today 00:00 for <days> days
  'calendar-list'(days) {
    const [start, end] = dayRange(days);
    const Calendar = Application('Calendar');
    const rows = [];
    for (const cal of Calendar.calendars()) {
      for (const e of cal.events.whose({ _and: [{ startDate: { _greaterThan: start } }, { startDate: { _lessThan: end } }] })()) {
        rows.push({ start: e.startDate(), text: `${stamp(e.startDate())} | ${e.summary()}${e.location() ? ' @ ' + e.location() : ''}` });
      }
    }
    rows.sort((a, b) => a.start - b.start);
    return rows.map((r) => r.text).join('\n') || 'Không có lịch nào.';
  },
  // calendar-add <title> <start> [minutes=60]
  'calendar-add'(title, start, minutes) {
    const Calendar = Application('Calendar');
    const from = when(start);
    const to = new Date(from.getTime() + Number(minutes || 60) * 6e4);
    const cal = Calendar.calendars().find((c) => c.writable()) || Calendar.calendars()[0];
    cal.events.push(Calendar.Event({ summary: title, startDate: from, endDate: to }));
    return `Đã thêm lịch: ${title} ${stamp(from)}–${stamp(to).slice(11)} (${cal.name()})`;
  },
  // notes-add <title> <body>
  'notes-add'(title, body) {
    const Notes = Application('Notes');
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    Notes.defaultAccount().notes.push(Notes.Note({ body: `<h1>${esc(title)}</h1>${esc(body)}` }));
    return `Đã ghi chú: ${title}`;
  },
  // timer <minutes> <message>: notification + spoken alert, detached so it outlives the agent
  timer(minutes, message) {
    const seconds = Math.round(Number(minutes) * 60);
    if (!(seconds > 0 && seconds <= 86400)) throw new Error(`Số phút không hợp lệ: ${minutes}`);
    const text = String(message || 'Hết giờ rồi');
    const notify = `display notification ${JSON.stringify(text)} with title "Tibo"`;
    const say = `/usr/bin/say -v Linh ${q(text)} || /usr/bin/say ${q(text)}`;
    app.doShellScript(`nohup /bin/sh -c ${q(`sleep ${seconds}; /usr/bin/osascript -e ${q(notify)}; ${say}`)} >/dev/null 2>&1 &`);
    const due = new Date(Date.now() + seconds * 1000);
    return `Đã hẹn giờ ${minutes} phút, báo lúc ${stamp(due).slice(11)}: ${text}`;
  },
  // mail-draft <to> <subject> <body>: opens a compose window in the default mail app, never sends
  'mail-draft'(to, subject, body) {
    const url = `mailto:${encodeURIComponent(to || '')}?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body || '')}`;
    app.doShellScript(`/usr/bin/open ${q(url)}`);
    return `Đã mở thư nháp gửi ${to || '(chưa có người nhận)'}; người dùng tự bấm gửi.`;
  },
};

function run(argv) {
  const [name, ...args] = argv;
  const command = commands[name];
  if (!command) return `Lệnh không có: ${name}. Có: ${Object.keys(commands).join(', ')}`;
  return command(...args);
}
