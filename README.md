# template-dev-gs

Template Google Apps Script สำหรับ clone ไปเริ่มโปรเจกต์ใหม่ พร้อม safe push จาก `template-shoppe-ads`: ตรวจ remote → สำรอง source ก่อนเขียนทับเมื่อจำเป็น → push → ตรวจผลและสร้าง Version อ้างอิง Git commit

## ลิงก์โปรเจกต์

Template นี้ยังไม่ผูกกับชีตหรือ Apps Script จริง หลังนำไปใช้ให้แทน placeholder ในตารางด้วยลิงก์ที่ตรวจสอบแล้วของโปรเจกต์นั้น เพื่อเปิดชีตจาก README ได้ทันที

| Environment | Google Sheets | Apps Script |
| --- | --- | --- |
| Default | [เปิดชีต](https://docs.google.com/spreadsheets/d/PUT_SPREADSHEET_ID_HERE/edit) | [เปิดสคริปต์](https://script.google.com/home/projects/PUT_SCRIPT_ID_HERE/edit) |

- ถ้าใช้หลาย environment ให้เปลี่ยนชื่อหรือเพิ่มแถวตามที่ใช้จริง เช่น TEST / PROD และตรวจให้แต่ละแถวตรงกับ `.clasp*.json` ของ environment นั้น
- ใช้ Spreadsheet ID จาก URL ของชีต และ Script ID จาก Apps Script Project Settings เป็นคนละค่า ห้ามนำ Script ID มาสร้างลิงก์ชีต หากต้องเปิด tab เฉพาะ ให้ใช้ URL ที่ตรวจสอบแล้วพร้อม `#gid=...`
- ถ้าชีตที่ผูกกับ script กับชีตข้อมูลที่อ่าน/เขียนเป็นคนละไฟล์ ให้ใส่ทั้งสองลิงก์พร้อมชื่อหน้าที่ หากไม่มีชีตให้ระบุว่าไม่ใช้ชีต; ถ้ายังไม่ทราบลิงก์ให้ระบุว่ารอยืนยันแทนการเดา
- การใส่ลิงก์ไม่เปลี่ยนสิทธิ์เข้าถึง Google Sheets แต่เปิดเผย URL/ID ให้ผู้อ่าน repo เห็น ก่อนเผยแพร่ repo ให้ตรวจว่าลิงก์เหมาะกับผู้เข้าถึง repo โดยไม่เปิดสิทธิ์ชีตเพิ่มอัตโนมัติ

## เริ่มต้นหลัง clone

ใช้ Node.js 20+ และ Git เปิด terminal ที่ root ของโปรเจกต์:

```sh
npm ci
npm test
```

บน Windows ถ้า PowerShell บล็อก `npm.ps1` ให้ใช้ `npm.cmd` แทน `npm`

1. เปลี่ยนชื่อโปรเจกต์ใน `package.json` แล้วรัน `npm install --package-lock-only` ให้ lockfile ตรงกัน
2. เปิด spreadsheet ปลายทาง → Extensions → Apps Script → Project Settings แล้วคัดลอก **Script ID** ใส่ `.clasp.json` แทน `PUT_SCRIPT_ID_HERE` (คนละค่ากับ Spreadsheet ID)
3. หากแยก TEST/PROD ให้ใส่ Script ID ของแต่ละโปรเจกต์ใน `.clasp.test.json` / `.clasp.prod.json`; ไฟล์ที่ยังไม่ใช้ปล่อย placeholder ไว้ได้ แล้วเติมลิงก์ชีตและ Apps Script ในตาราง **ลิงก์โปรเจกต์** ให้ตรงกับแต่ละ environment
4. เปิด [Google Apps Script API](https://script.google.com/home/usersettings) แล้วรัน `npm run login`
5. ตั้งค่าตามหัวข้อถัดไปและเติม logic ใน `Main.gs`; manifest เริ่มต้นใช้ V8 และ timezone `Asia/Bangkok`
6. Commit ไฟล์ที่แก้ให้ Git worktree สะอาด จากนั้นตรวจและ push ตามคำสั่งด้านล่าง
7. เปิด Apps Script editor แล้วรัน `main` เพื่ออนุญาตสิทธิ์และตรวจการเข้าถึงชีต ตัวอย่างนี้อ่านชื่อ tab โดยยังไม่เขียนข้อมูล

หากเริ่มจากการคัดลอกโฟลเดอร์แทน `git clone` ให้รัน `git init` ในโฟลเดอร์นี้ก่อน แล้วสร้าง commit แรก Safe push รวมถึง `push:local-check` ต้องมี Git repository และ commit แล้ว

## Config และ Properties

**Remark: จะ add ค่าตรงเข้า `APP_CONFIG` ใน `Config.gs` หรือ add ที่ properties ของ Apps Script/Spreadsheet ก็ได้** ใช้ชื่อ key เหมือนกันและไม่ต้องใส่ซ้ำทุกที่

| Key | ใช้ทำอะไร | เมื่อยังไม่ตั้งค่า |
| --- | --- | --- |
| `APP_NAME` | ชื่อแอปสำหรับข้อความ log | `Apps Script starter` |
| `SPREADSHEET_ID` | ID จาก URL ของ spreadsheet ปลายทาง | ใช้ spreadsheet ที่ผูกกับ script |
| `SHEET_NAME` | ชื่อ tab ปลายทาง | ใช้ tab แรก |
| `API_BASE_URL` | URL สำหรับ API ที่จะเพิ่มภายหลัง | ยังไม่ใช้งาน |
| `API_KEY` | Key สำหรับ API ที่จะเพิ่มภายหลัง | ยังไม่ใช้งาน |

`getConfig()` เลือกค่าแยกตาม key ตามลำดับ **Document Properties → Script Properties → APP_CONFIG** โดยข้ามค่าว่างและค่าที่ขึ้นต้นด้วย `PUT_` หากเพิ่ม key ใหม่ ให้เพิ่มใน `APP_CONFIG` เพื่อให้ helper อ่านค่านั้นด้วย

- **Config โดยตรง:** แทน placeholder ใน `Config.gs` ด้วยค่าที่ต้องการ ค่าใน source จะถูก commit และรวมใน Apps Script Versions จึงควรใช้ Properties สำหรับ API key/token จริง
- **Script Properties ผ่านหน้าจอ:** เปิด spreadsheet → Extensions → Apps Script → Project Settings → Script properties → Add script property แล้วใส่ key/value จากตาราง เช่น `SHEET_NAME` = `Data`
- **Document Properties ของ spreadsheet:** ใช้กับ script ที่ผูกกับ spreadsheet โดยตั้งผ่านโค้ด ตัวอย่างด้านล่างให้นำไปปรับค่าและรันเองหนึ่งครั้งใน Apps Script editor

```js
function setupDocumentProperties() {
  const properties = PropertiesService.getDocumentProperties();
  if (!properties) throw new Error('Run this from a spreadsheet-bound script.');
  properties.setProperties({
    APP_NAME: 'My spreadsheet app',
    SHEET_NAME: 'Data'
  });
}
```

Script Properties กับ Document Properties เป็นคนละ store; หน้าจอ Project Settings จัดการ Script Properties ส่วน Document Properties ของ bound script ตั้งผ่านโค้ดได้ หากเป็น standalone script จะไม่มี Document Properties และ helper จะอ่าน Script Properties/Config ต่อให้ อ้างอิง [PropertiesService](https://developers.google.com/apps-script/reference/properties/properties-service) และ [การจัดการ Properties](https://developers.google.com/apps-script/guides/properties)

เมื่อเปลี่ยนค่าใน Config แล้วไม่เห็นผล ให้ตรวจค่า key เดียวกันใน Properties ที่มีลำดับสูงกว่า การแก้ Properties ไม่ต้อง push source ใหม่ และ safe push ไม่สำรอง Properties

## Safe push

```sh
git status
git add <files>
git commit -m "Configure Apps Script project"
npm run push:local-check
npm run push:check
npm run push
```

แทน `<files>` ด้วยไฟล์ที่ต้องการ commit (โฟลเดอร์ใหม่ที่ตรวจแล้วใช้ `git add .` ได้) `push:local-check` ตรวจชุดไฟล์ในเครื่อง ไม่โหลด credentials หรือเรียก Google และอนุญาตงานที่ยังไม่ commit แต่ต้องแทน Script ID placeholder ก่อน ส่วน `push:check` และ `push` ต้องมี worktree สะอาดรวมถึงไม่มี untracked files

`push:check` อ่าน Remote HEAD/Versions เท่านั้น ไม่เขียน remote; `push` ตรวจใหม่แล้วสำรอง HEAD หากต่างจาก Version ล่าสุดหรือยังไม่มี Version จากนั้นอัปโหลด source ทั้งชุด ตรวจผล และสร้าง Version ชื่อ `local push <git-sha>`

สำหรับ TEST/PROD:

```sh
npm run push:test -- --dry-run
npm run push:test
npm run push:prod -- --dry-run
npm run push:prod
```

ใช้ `npm run push` เพื่อให้ผ่าน backup flow; `clasp push` โดยตรงจะข้าม wrapper นี้ งดแก้ Apps Script UI ระหว่าง push เพราะ lock ป้องกันได้เฉพาะ worktrees ของ repo เดียวกัน ไม่ครอบคลุมผู้เขียนจากเครื่องอื่น หาก push ผิดพลาดให้ตรวจ stage และ HEAD/Versions ก่อนลองใหม่

Safe push ส่ง **source ทั้งชุด** จึงลบไฟล์ remote ที่ไม่มีใน local ด้วย ตรวจ Script ID ให้ตรงกับโปรเจกต์ที่ต้องการแทนที่ Apps Script Version สำรองเฉพาะ source ไม่รวมข้อมูล/สูตร/format/tabs ใน spreadsheet หรือ Properties และไม่สร้าง deployment อ่าน flow, ข้อจำกัด และการจัดการกรณีล้มเหลวใน [SAFE_PUSH.md](SAFE_PUSH.md)

## ไฟล์สำหรับต่อยอด

- `Config.gs` — ค่าเริ่มต้นและ helper อ่าน Properties
- `Main.gs` — entry point และ TODO สำหรับ logic ของโปรเจกต์
- `appsscript.json` — manifest
- `.clasp*.json` — Script ID placeholder สำหรับแต่ละปลายทาง
- `tools/safe-push.cjs` — wrapper เดิมจาก `template-shoppe-ads` ใช้ clasp ที่ pin ไว้รุ่น `3.4.1`
- `tests/` — ทดสอบ safe push และ config ด้วย Node โดยไม่ติดต่อ Google

`.claspignore` ส่งเฉพาะ `.gs`, `.html` และ `appsscript.json` ห้ามใส่ไฟล์ตัวอย่าง `.gs`/`.html` ที่ไม่ต้องการอัปโหลดไว้ใน repo โดยไม่เพิ่ม ignore ส่วน credentials, `.env` และ `node_modules` ถูก Git ignore แล้ว ควร commit `package-lock.json` ด้วย
