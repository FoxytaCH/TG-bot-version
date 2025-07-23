/**
 * Главный код Telegram-бота для сотрудников и менеджеров.
 * Управляет сменами, статусами, отпусками и пр., работая с Google Таблицей.
 * Таблица ID: 10Hv5Djy2uwwh3XXEXJVNwBKM_yG2F7AzbJ_PIKOto2M
 */

const SPREADSHEET_ID = '10Hv5Djy2uwwh3XXEXJVNwBKM_yG2F7AzbJ_PIKOto2M';
const SHEET_EMPLOYEES = 'Сотрудники';
const SHEET_INTERVALS = 'Интервалы';
const SHEET_LOG = 'Лог';
const SHEET_DEBUG = 'Debug';

function setBotToken() {
  PropertiesService.getScriptProperties().setProperty('TELEGRAM_BOT_TOKEN', '7795221712:AAHXFZ0JJki_nencE-qRex6WYAFlqYWUDdE');
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const msg = data.message;
    const callback = data.callback_query;
    Logger.log(callback)
    const userId = msg ? msg.from.id : callback.from.id;
    const text = msg ? msg.text : callback.data;
    if (msg && text === '/start') return showMainMenu(userId);
    if (callback) return handleCallback(callback);
  } catch (err) {
    Logger.log(err.message)
  }
}

function showMainMenu(userId) {
  const isManager = isUserManager(userId);
  const menu = {
    inline_keyboard: isManager ? [
      [{ text: 'Панель менеджера', callback_data: 'manager_menu' }],
      [{ text: 'Мои функции', callback_data: 'employee_menu' }],
    ] : [
      [{ text: 'Мои функции', callback_data: 'employee_menu' }],
    ]
  };
  sendMessage(userId, 'Главное меню', menu);
}

function handleCallback(callback) {
  Logger.log("log");
  const userId = callback.from.id;
  const data = callback.data;
  Logger.log(data);
  answerCallbackQuery(callback.id);

  if (data.startsWith('break_at_')) {
    const timeStr = data.replace('break_at_', '');
    return scheduleBreakForUser(userId, timeStr);
  }

  switch (data) {
    case 'employee_menu':
      return showEmployeeMenu(userId);
    case 'manager_menu':
      return showManagerMenu(userId);
    case 'employee_online':
      return employeeGoOnline(userId);
    case 'employee_offline':
      return employeeGoOffline(userId);
    case 'employee_take_break_now':
      return employeeTakeBreak(userId);
    case 'employee_schedule_break':
      return employeeScheduleBreak(userId);
    case 'employee_request_vacation':
      return employeeRequestVacation(userId);
    case 'employee_request_sick':
      return employeeRequestSick(userId);
  }
}

function showEmployeeMenu(userId) {
  const menu = {
    inline_keyboard: [
      [{ text: 'Выйти в онлайн', callback_data: 'employee_online' }],
      [{ text: 'Уйти в оффлайн', callback_data: 'employee_offline' }],
      [{ text: 'Перерыв сейчас', callback_data: 'employee_take_break_now' }],
      [{ text: 'Запланировать перерыв', callback_data: 'employee_schedule_break' }],
      [{ text: 'Запросить отпуск', callback_data: 'employee_request_vacation' }],
      [{ text: 'Запросить больничный', callback_data: 'employee_request_sick' }]
    ]
  };
  sendMessage(userId, 'Меню сотрудника:', menu);
}

function employeeGoOnline(userId) {
  updateEmployeeStatus(userId, 'Онлайн');
  setStatusTimestamp(userId, 'online');
  logEvent(userId, 'Онлайн');
  sendMessage(userId, 'Вы вышли в онлайн');
}

function employeeGoOffline(userId) {
  updateEmployeeStatus(userId, 'Оффлайн');
  clearStatusTimestamps(userId);
  logEvent(userId, 'Оффлайн');
  sendMessage(userId, 'Вы ушли в оффлайн');
}

function employeeTakeBreak(userId) {
  if (!canTakeBreakNow(userId)) {
    return sendMessage(userId, 'Сейчас нельзя взять перерыв. Нельзя в первый и последний час смены.');
  }
  updateEmployeeStatus(userId, 'Перерыв');
  setStatusTimestamp(userId, 'break');
  createInterval(userId, 'Перерыв', new Date(), new Date(Date.now() + 60 * 60 * 1000));
  logEvent(userId, 'Начат перерыв');
  sendMessage(userId, 'Вы ушли на перерыв.');
}

function employeeScheduleBreak(userId) {
  const today = new Date();
  const shift = getShiftForUser(userId, today);
  if (!shift) return sendMessage(userId, 'Сегодня у вас нет смены.');

  const menu = {
    inline_keyboard: getBreakTimeSlots(shift.start, shift.end)
      .map(time => [{ text: time, callback_data: 'break_at_' + time }])
  };
  sendMessage(userId, 'Выберите время начала перерыва (1 час, только сегодня):', menu);
}

function scheduleBreakForUser(userId, timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const now = new Date();
  const breakStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
  const breakEnd = new Date(breakStart.getTime() + 60 * 60 * 1000);

  const shift = getShiftForUser(userId, now);
  if (!shift || breakStart < new Date(shift.start) || breakEnd > new Date(shift.end)) {
    return sendMessage(userId, 'Указанное время выходит за пределы вашей смены.');
  }

  createInterval(userId, 'Перерыв (запланирован)', breakStart, breakEnd);
  logEvent(userId, `Запланирован перерыв с ${timeStr}`);
  sendMessage(userId, `Перерыв запланирован на ${timeStr} (1 час)`);
}

function employeeRequestVacation(userId) {
  const now = new Date();
  createInterval(userId, 'Отпуск (ожидает)', now, now);
  logEvent(userId, 'Запросил отпуск');
  sendMessage(userId, 'Запрос на отпуск отправлен менеджеру.');
}

function employeeRequestSick(userId) {
  const now = new Date();
  createInterval(userId, 'Больничный (ожидает)', now, now);
  logEvent(userId, 'Запросил больничный');
  sendMessage(userId, 'Запрос на больничный отправлен менеджеру.');
}

function sendMessage(userId, text, replyMarkup) {
  const payload = {
    method: 'sendMessage',
    chat_id: userId,
    text: text,
    reply_markup: replyMarkup
  };
  const url = 'https://api.telegram.org/bot' + getBotToken() + '/sendMessage';
  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload)
  });
}

function answerCallbackQuery(id) {
  const url = 'https://api.telegram.org/bot' + getBotToken() + '/answerCallbackQuery';
  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ callback_query_id: id })
  });
}

function getBotToken() {
  return PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
}

function isUserManager(userId) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_EMPLOYEES);
  const data = sheet.getDataRange().getValues();
  return data.some(row => row[0] && row[1] == userId && row.includes('менеджер'));
}

function updateEmployeeStatus(userId, status) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_EMPLOYEES);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] == userId) {
      sheet.getRange(i + 1, 5).setValue(status); // 'Текущий статус'
      return;
    }
  }
}

function logEvent(userId, action) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_LOG);
  sheet.appendRow([new Date(), userId, action]);
}

function getShiftForUser(userId, date) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_EMPLOYEES);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] == userId) {
      return {
        start: data[i][2],
        end: data[i][3]
      };
    }
  }
  return null;
}

function canTakeBreakNow(userId) {
  const shift = getShiftForUser(userId, new Date());
  if (!shift) return false;
  const now = new Date();
  const start = new Date(shift.start);
  const end = new Date(shift.end);

  const firstHourEnd = new Date(start.getTime() + 60 * 60 * 1000);
  const lastHourStart = new Date(end.getTime() - 60 * 60 * 1000);

  return now >= firstHourEnd && now <= lastHourStart;
}

function setStatusTimestamp(userId, type) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_EMPLOYEES);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] == userId) {
      if (type === 'online') sheet.getRange(i + 1, 7).setValue(new Date());
      if (type === 'break') sheet.getRange(i + 1, 8).setValue(new Date());
      return;
    }
  }
}

function clearStatusTimestamps(userId) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_EMPLOYEES);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] == userId) {
      sheet.getRange(i + 1, 7).setValue(''); // 'Времени в онлайн'
      sheet.getRange(i + 1, 8).setValue(''); // 'Времени в перерыве'
      return;
    }
  }
}

function createInterval(userId, type, start, end) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_INTERVALS);
  sheet.appendRow([userId, type, start, end]);
}

function getBreakTimeSlots(start, end) {
  const result = [];
  const startTime = new Date(start);
  const endTime = new Date(end);

  const firstHourEnd = new Date(startTime.getTime() + 60 * 60 * 1000);
  const lastHourStart = new Date(endTime.getTime() - 60 * 60 * 1000);

  for (let t = new Date(firstHourEnd); t < lastHourStart; t.setMinutes(t.getMinutes() + 30)) {
    result.push(Utilities.formatDate(new Date(t), Session.getScriptTimeZone(), 'HH:mm'));
  }
  return result;
}
