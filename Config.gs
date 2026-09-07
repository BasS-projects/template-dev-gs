/**
 * ตั้งค่าตรง APP_CONFIG หรือเพิ่ม key เดียวกันใน properties ของ Apps Script/Spreadsheet ก็ได้
 * ลำดับ: Document Properties > Script Properties > APP_CONFIG (ข้ามค่าว่าง/PUT_ placeholders)
 * Script Properties: Spreadsheet > Extensions > Apps Script > Project Settings > Script properties
 * Document Properties: ตั้งผ่าน PropertiesService.getDocumentProperties() ใน bound script
 * เก็บ API key/token จริงใน Properties แทนการ commit ลง Git; ดูตัวอย่างใน README.md
 */
const APP_CONFIG = {
  APP_NAME: 'PUT_APP_NAME_HERE',
  SPREADSHEET_ID: 'PUT_SPREADSHEET_ID_HERE', // ว่าง/placeholder = ใช้ spreadsheet ที่ผูกกับ script
  SHEET_NAME: 'PUT_SHEET_NAME_HERE', // ว่าง/placeholder = ใช้ tab แรก
  API_BASE_URL: 'PUT_API_BASE_URL_HERE', // เผื่อเชื่อม API ภายหลัง
  API_KEY: 'PUT_API_KEY_HERE' // เผื่อเชื่อม API ภายหลัง; main ยังไม่เรียก API
};

function getConfig() {
  const documentStore = PropertiesService.getDocumentProperties();
  const documentValues = documentStore ? documentStore.getProperties() : {};
  const scriptValues = PropertiesService.getScriptProperties().getProperties();
  const config = {};
  Object.keys(APP_CONFIG).forEach(function (key) {
    const value = [documentValues[key], scriptValues[key], APP_CONFIG[key]].find(function (candidate) {
      return candidate !== undefined && candidate !== null &&
        String(candidate).trim() !== '' && !String(candidate).trim().startsWith('PUT_');
    });
    config[key] = value === undefined ? '' : String(value);
  });
  return config;
}
