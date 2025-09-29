# AI Creativity Tool

เว็บแอปพลิเคชันสำหรับช่วยสร้างสรรค์ไอเดีย, บทพูด, รูปภาพ และประเมินผลงานด้วย Gemini API

## การ Deploy

แอปพลิเคชันนี้เป็นเว็บแบบสแตติก (Static Web App) ซึ่งประกอบด้วยไฟล์ HTML, CSS, และ TSX สามารถนำไป deploy บนผู้ให้บริการโฮสติ้งสำหรับเว็บสแตติกได้ทันที เช่น Vercel, Netlify, หรือ GitHub Pages

### ขั้นตอนสำคัญก่อนการ Deploy

ก่อนที่จะนำแอปพลิเคชันขึ้นใช้งานจริง มีการตั้งค่าที่จำเป็น 2 ส่วนที่คุณต้องดำเนินการ:

1.  **ตั้งค่า Gemini API Key:**
    แอปพลิเคชันจำเป็นต้องใช้ Gemini API Key เพื่อทำงาน คุณต้องตั้งค่า Environment Variable บนแพลตฟอร์มโฮสติ้งที่คุณเลือก:
    -   **Variable Name:** `API_KEY`
    -   **Variable Value:** `[Your_Gemini_API_Key_Here]`

    การตั้งค่านี้จะทำให้โค้ดในส่วน `process.env.API_KEY` สามารถเข้าถึง Key ของคุณได้อย่างปลอดภัยโดยไม่ต้องเปิดเผยในโค้ดที่ผู้ใช้เห็นได้

2.  **ตั้งค่า Google Apps Script สำหรับ Logging:**
    เพื่อให้ฟีเจอร์การบันทึกข้อมูลการใช้งาน (logging) ทำงานได้ คุณต้อง:
    -   สร้างโปรเจกต์ Google Apps Script ที่ผูกกับ Google Sheet เพื่อรับข้อมูล
    -   Deploy Apps Script ของคุณเป็น Web App
    -   นำ URL ของ Web App ที่ได้ มาใส่แทนที่ placeholder ในไฟล์ `index.tsx`

    **ไฟล์:** `index.tsx`
    **แก้ไขตัวแปร:**
    ```javascript
    const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID_HERE/exec';
    ```
    เปลี่ยน `https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID_HERE/exec` ให้เป็น URL จริงที่คุณได้มาจากการ deploy Google Apps Script

### ตัวอย่างการ Deploy บน Vercel

1.  นำโค้ดทั้งหมดของโปรเจกต์นี้ไปไว้บน Repository (เช่น GitHub, GitLab, Bitbucket)
2.  ลงชื่อเข้าใช้ Vercel และนำเข้าโปรเจกต์ (Import Project) จาก Repository ของคุณ
3.  ในหน้าตั้งค่าของโปรเจกต์ (Project Settings) ให้ไปที่เมนู **Environment Variables**
4.  เพิ่ม Variable ใหม่ โดยตั้งชื่อเป็น `API_KEY` และใส่ค่า Gemini API Key ของคุณลงในช่อง Value
5.  กด Deploy Vercel จะทำการ build และ deploy แอปพลิเคชัน พร้อมทั้งให้ URL สาธารณะสำหรับเข้าใช้งาน

เมื่อทำตามขั้นตอนเหล่านี้เรียบร้อยแล้ว แอปพลิเคชันของคุณก็จะพร้อมใช้งานและสามารถแชร์ให้ผู้อื่นได้ครับ
