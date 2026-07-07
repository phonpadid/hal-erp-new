# BOOTSTRAP — สร้างโปรเจกต์นี้ด้วย Claude Code + OpenSpec

ไฟล์ชุดนี้คือ "source of truth" ของระบบ ERP อนุมัติเอกสาร + คุมงบ + โควตา
เขียนตาม convention ของ OpenSpec (spec-driven development) ให้ Claude Code นำไป
สร้างโปรเจกต์ได้ทันที

## โครงสร้างไฟล์
```
.
├── CLAUDE.md                         # กฎ/invariants โหลดอัตโนมัติทุก session
├── erp_approval_system.dbml          # โมเดลฐานข้อมูล 37 ตาราง (canonical)
└── openspec/
    ├── config.yaml                   # tech stack, glossary, invariants, rules
    ├── project.md                    # ภาพรวมโปรเจกต์
    └── specs/                        # source of truth แยกตาม capability
        ├── multi-company/spec.md
        ├── rbac/spec.md
        ├── budget-control/spec.md
        ├── quota-management/spec.md
        ├── document-engine/spec.md
        ├── approval-workflow/spec.md
        ├── multi-currency/spec.md
        ├── master-data/spec.md
        └── notifications/spec.md
```

## ขั้นตอนใช้งาน

### 1) เตรียมโปรเจกต์
- สร้างโฟลเดอร์โปรเจกต์ใหม่ แล้ววางโฟลเดอร์ `openspec/` ไว้ที่ root
- วางไฟล์ `erp_approval_system.dbml` ไว้ที่ root ด้วย
- เปิด terminal ในโฟลเดอร์นี้แล้วพิมพ์ `claude`

### 2) ติดตั้ง OpenSpec (ถ้ายังไม่มี)
```bash
npm install -g @fission-ai/openspec   # หรือใช้ npx ตามเอกสาร OpenSpec ล่าสุด
openspec init                          # ถ้ามี openspec/ อยู่แล้ว ให้ใช้เพื่อ refresh AI guidance
```
> หมายเหตุ: `specs/` ในชุดนี้เตรียมไว้ให้แล้ว ไม่ต้อง generate ใหม่ตั้งแต่ศูนย์
> ถ้า `openspec init` ถามจะทับไฟล์ ให้เก็บไฟล์ใน `specs/` ของชุดนี้ไว้

### 3) ปรับ tech stack (สำคัญ)
เปิด `openspec/config.yaml` แล้วแก้หัวข้อ RECOMMENDED TECH STACK ให้ตรงกับที่ทีมใช้
(ค่าเริ่มต้น: backend NestJS + PostgreSQL + MikroORM, frontend Vue 3 + PrimeVue 4 +
Tailwind/tailwindcss-primeui + @primevue/forms + Zod + Pinia) ส่วน GLOSSARY และ CORE INVARIANTS
ไม่ควรแก้ เพราะเป็นกฎที่ทุก capability อ้างถึง

> **ENV — `USER_PASSWORD`:** ตั้งค่าใน `back/.env` (ดู `back/.env.example`) เป็นรหัสผ่านเริ่มต้น
> สำหรับบัญชี login ที่สร้างผ่านหน้า employee-admin ("create account"). ผู้ดูแลไม่ต้องกรอกรหัสผ่าน
> เอง — เซิร์ฟเวอร์ hash ค่านี้ให้ ถ้าไม่ตั้งค่า flow สร้างบัญชีจะ fail closed (ปฏิเสธ) ควรให้ผู้ใช้
> เปลี่ยน/รีเซ็ตรหัสผ่านหลัง onboarding

### 4) สั่งสร้างทีละ capability (แนะนำลำดับนี้)
ใช้ workflow ของ OpenSpec ผ่าน Claude Code โดยสร้าง change แล้วให้มัน generate
proposal/design/tasks จากนั้น apply ทีละงาน เช่น:

```
/opsx:propose scaffold project from openspec/config.yaml and the dbml schema
/opsx:apply

/opsx:propose implement multi-company capability
/opsx:apply

/opsx:propose implement rbac capability
/opsx:apply
```

ลำดับที่แนะนำ:
1. multi-company   2. rbac   3. master-data   4. multi-currency
5. budget-control  6. quota-management   7. document-engine
8. approval-workflow   9. notifications

เหตุผล: capability ปลายน้ำ (เอกสาร/อนุมัติ) พึ่งพา capability ต้นน้ำ
(บริษัท/สิทธิ์/งบ/สกุลเงิน) จึงต้องมีของต้นน้ำก่อน

### 5) เฟสแรก (MVP) ที่แนะนำ
ทำเอกสาร 4–5 ประเภทที่ครอบคลุมพฤติกรรมครบทั้ง 4 แบบ:
- Purchase Requisition (ตัดงบ)
- Expense Claim (ตัดงบ)
- Leave Request (ตัดโควตา)
- Resignation (ไม่ตัดอะไร + post-action HR)
- Internal Memo (อนุมัติอย่างเดียว)
เมื่อ engine กลางเดินได้ เอกสารที่เหลือจะเป็นแค่ "การตั้งค่า" ไม่ใช่เขียนโค้ดใหม่

## กฎที่ Claude Code ต้องเคารพเสมอ (อยู่ใน config.yaml → CORE INVARIANTS)
- ทุกตารางหลัก scope ด้วย company_id ห้ามข้อมูลข้ามบริษัทรั่ว (ยกเว้น GROUP อ่านอย่างเดียว)
- budget_txn และ approval_log เป็น append-only ห้าม UPDATE/DELETE
- งบคงเหลือคำนวณจากผลรวมรายการเสมอ ไม่แก้ amount_total ทับ
- reject/cancel ต้องคืนงบและโควตาอัตโนมัติ
- ตรวจสิทธิ์ด้วย permission code ไม่ใช่ชื่อ role
- ออกเลขเอกสารด้วย SELECT FOR UPDATE
- อัตราแลกเปลี่ยนล็อกที่เอกสารตอน submit ส่วนต่าง FX เป็นเรื่องบัญชี ไม่ใช่งบ

## อ้างอิงรูปแบบ
- Requirement ใช้คำ RFC 2119: SHALL / MUST / SHOULD / MAY
- ทุก Requirement มีอย่างน้อย 1 Scenario แบบ Given/When/Then (#### สี่ hashtag)
- ชื่อ capability เป็น kebab-case ตรงกับชื่อโฟลเดอร์ใน specs/
