# System Design Roadmap — 24 tuần, phỏng vấn và dùng vào việc thật

App học tĩnh (HTML + JS, không backend) để tự học system design và kiến thức backend cho phỏng vấn mid–senior, với mục tiêu kép: qua phỏng vấn **và** áp dụng được ngay vào hệ thống đang làm.

## Chạy

- Bản online (GitHub Pages, repo public): https://nghiadevdevops.github.io/system-design-roadmap/ — mở trên điện thoại rồi "Thêm vào màn hình chính".

- Mở trực tiếp `index.html` bằng Chrome/Edge là chạy (mọi thứ offline).
- Hoặc phục vụ qua HTTP để dùng trong Browser pane của Claude:

```bash
python -m http.server 8767 --directory "C:/Users/DCN/Documents/system-design-roadmap"
```

Tiến độ lưu trong `localStorage` (key `sdr.v1`). Xuất/nhập JSON ở trang **Cài đặt & sao lưu**. Nên xuất mỗi tuần.

## Lộ trình

| Giai đoạn | Tuần | Nội dung | Đầu ra đo được |
|---|---|---|---|
| 1. Nền tảng | 1–5 | F1–F10: số liệu, ước lượng, mạng, OS, DB, API, cache, queue, độ tin cậy, mở rộng | KT1 ≥ 21/30, 4 lab |
| 2. Khối xây dựng | 6–13 | B1–B22: LB/CDN, replication, sharding, NoSQL, consistency, consensus, distributed tx, broker, rate limit, ID, search, storage, data, observability, security, microservices, resilience, deploy, multi-tenant, realtime, hệ có LLM/RAG, đa vùng & thảm hoạ | KT2 ≥ 22/30, 7 mock ≥ 8/15 |
| 3. Bài toán kinh điển | 14–20 | C1–C23: 18 bài kinh điển + C19 là chính hệ SBOM của bạn + trợ lý RAG, distributed cache, top-K/trending, ví điện tử; mỗi tuần 1 mock lạnh → đọc case → làm lại | KT3 ≥ 24/30, mock ≥ 10/15 |
| 4. Phỏng vấn & thực chiến | 21–24 | K1–K13: Go, concurrency, SQL, LLD, networking, OS, cloud, testing, behavioral, postmortem, design doc, ngày phỏng vấn, vòng coding; 6 đề lạ X1–X6 | KT4 ≥ 26/30, đề lạ ≥ 11/15 |

Tuần 1 làm **baseline**: KT0 + mock M1 lạnh. Tuần 14 làm lại M1 để đo tiến bộ. Tuần 13 và 20 là **tuần đệm** để bù phần còn nợ. Bảy đề mock không nằm trong lịch (M4, M9, M12, M13, M15, M17, M22) là **kho dự phòng** cho tuần nhẹ hoặc để tự kiểm trước ngày phỏng vấn thật.

## Trong app có gì

- **Bài học** (68 + 10 bài tab Job): mỗi bài = Vấn đề cần giải → Cốt lõi (bảng, sơ đồ) → Sai lầm hay gặp → Nói thế nào trong phỏng vấn (EN) → **Áp dụng vào hệ thống SBOM của bạn** → quiz 8 câu (trắc nghiệm, điền, câu mở chấm theo từ khoá).
- **Mock interview** (29 đề + 4 đề nghiệp vụ ở tab Job): 5 pha bấm giờ (làm rõ 5' → ước lượng 5' → tổng thể 12' → đào sâu 18' → tổng kết 5'), ghi chú từng pha, nút "Hỏi người phỏng vấn" (giả định), nút "Gợi ý" (bị trừ điểm), tự chấm bằng checklist + rubric 5 tiêu chí × 0–3, rồi mới hiện lời giải. Lịch sử và biểu đồ điểm.
- **Test kiến thức** (5 đề × 30 câu, bấm giờ): điểm theo topic, link bài học cần ôn.
- **Hỏi nhanh 2 phút** (90 câu): câu hỏi kiểu phỏng vấn, đáp án mẫu, tự chấm theo Leitner.
- **Flashcard** (9 bộ, ~250 thẻ): latency numbers, rule of thumb, khái niệm, trade-off, pattern, Go, DB, AI/LLM & RAG, đa vùng + sổ cái + cấu trúc xấp xỉ + vòng coding. Leitner 5 hộp.
- **Drill**: trộn câu hỏi quiz từ mọi bài, lọc theo topic/loại, làm riêng câu sai.
- **Máy tính ước lượng**: DAU → QPS, dung lượng, băng thông, cache, số máy; kèm bảng latency, luỹ thừa 2, nines.
- **Lab Go** (12): từ đo latency, pool/timeout, cache stampede, idempotent consumer + DLQ, consistent hashing, outbox, rate limiter Lua, Snowflake, bloom filter, distributed cron, load test + pprof, đến capstone mini SBOM pipeline.
- **Sổ tay thiết kế**: ADR mini, postmortem mini, bài học, "áp dụng thứ Sáu", khác biệt sau mock, câu chuyện STAR. Xuất Markdown.
- **Thuật ngữ** (hơn 400 mục): bảng tra cứu tiếng Việt có tìm kiếm và lọc theo chủ đề; trong bài học, thuật ngữ được gạch chân chấm, bấm vào hiện định nghĩa ngắn (bật/tắt ở Cài đặt).
- **Tab Job (OTS Full-stack Node/Next)**: trang đầu "Kiến thức cần học" (11 mảng theo JD, 101 khái niệm có checklist, bài J chính + bài liên quan), phân tích JD, ma trận khớp kỹ năng chỉnh được, kế hoạch 4 tuần, bài J1–J10, 70 câu hỏi kỹ thuật nhanh, 4 mock nghiệp vụ hãng tàu (JM1–JM4), 10 câu behavioral gắn với JD, dự án luyện tay NestJS + Next.js, pitch và checklist ngày phỏng vấn.
- **Hướng dẫn**: cách làm đề (khung 5 pha, câu hỏi làm rõ, công thức ước lượng, rubric, luyện một mình, prompt AI làm người phỏng vấn, 12 sai lầm, **ưu tiên thế nào khi lịch phỏng vấn tới sớm**), cách làm test & oral, dùng vào công việc (mẫu design doc, ADR, capacity plan, production readiness, postmortem), tài nguyên.

## Cấu trúc file

```
index.html            shell + CSS + engine (router, markdown mini + sơ đồ SVG, quiz, Leitner, mock, test, oral, lab, sổ tay)
data/schedule.js      PRINCIPLES, PHASE_OVERVIEW, RUBRIC, PHASE_MIN, ROADMAP 24 tuần, WEEKLY_TEMPLATE, ABOUT
data/phase1.js        LESSONS_F  (F1–F10)
data/phase2a.js       LESSONS_B1 (B1–B5)
data/phase2a2.js      LESSONS_B1B (B6–B10)
data/phase2b.js       LESSONS_B2 (B11–B20)
data/phase2c.js       LESSONS_B2B (B21 LLM/RAG, B22 đa vùng & thảm hoạ)
data/cases1.js        LESSONS_C1 (C1–C10) + MOCKS M1–M10
data/cases2.js        LESSONS_C2 (C11–C19) + MOCKS M11–M19
data/cases3.js        LESSONS_C3 (C20 RAG, C21 distributed cache, C22 top-K, C23 ví điện tử)
data/mocks3.js        MOCKS M20–M23 (cho C20–C23)
data/knowledge.js     LESSONS_K  (K1–K12)
data/knowledge2.js    LESSONS_K2 (K13 vòng coding)
data/tests.js         KTESTS (KT0–KT4) + ORAL (90 câu)
data/cards.js         FLASH (D1–D7)
data/cards2.js        FLASH (D8 AI/LLM, D9 đa vùng + sổ cái + xấp xỉ + coding)
data/labs.js          LABS (L1–L12)
data/mocks_extra.js   MOCKS X1–X6 (có reference)
data/guides.js        GUIDES (method, knowledge, real, resources)
data/job.js           JOB (overview, domain, matrix, plan, project, behavioral, pitch, ask, checklist) + thuật ngữ hãng tàu
data/job_syllabus.js  JOB.syllabus (11 mảng kiến thức, concepts, lessons, related, practice)
data/job_lessons1-3.js LESSONS_J1..J3 (J1–J10, type job)
data/job_qa.js        JOB_QA (JQ1–JQ70)
data/job_mocks.js     MOCKS JM1–JM4 (có reference)
data/glossary.js      GLOSSARY (thuật ngữ: term, alt, vi, def, ex, topic, see)
data/glossary2.js     GLOSSARY phần 2
data/glossary3.js     GLOSSARY phần 3 (AI/RAG, DR, xấp xỉ, sổ cái, coding)
tools/validate.js     node tools/validate.js data/<file>.js — kiểm tra schema trước khi sửa/thêm nội dung
```

## Thêm hoặc sửa nội dung

- Nội dung nằm trong template literal: **không dùng backtick** trong nội dung, inline code dùng `[[code]]`, khối code dùng `~~~`, sơ đồ dùng khối `:::diagram` với các dòng `A[Nhãn] -> B : nhãn cạnh`.
- Thêm bài: push object `{id,type,topic,title,time,goal,md,apply,quiz}` vào mảng tương ứng, thêm id vào `ROADMAP[w].lessons` để hiện trong tuần.
- Thêm mock: push vào `window.MOCKS` với `caseId` (có bài case) hoặc `reference` (đề lạ).
- Sau khi sửa: `node tools/validate.js data/<file>.js` phải in `All good`.
