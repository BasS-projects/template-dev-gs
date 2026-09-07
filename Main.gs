/** Entry point สำหรับต่อยอดงาน: ตัวอย่างนี้อ่านชื่อ tab เท่านั้น ยังไม่เขียนข้อมูลหรือเรียก API */
function main() {
  const config = getConfig();
  const spreadsheet = config.SPREADSHEET_ID
    ? SpreadsheetApp.openById(config.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error('Set SPREADSHEET_ID in Config.gs or Properties, or use a spreadsheet-bound script.');
  }
  const sheet = config.SHEET_NAME
    ? spreadsheet.getSheetByName(config.SHEET_NAME)
    : spreadsheet.getSheets()[0];
  if (!sheet) throw new Error('Target sheet not found. Check SHEET_NAME.');

  // TODO: เพิ่ม business logic ของโปรเจกต์ที่นี่ โดยใช้ config, spreadsheet และ sheet
  console.log((config.APP_NAME || 'Apps Script starter') + ': ready on sheet ' + sheet.getName());
}
