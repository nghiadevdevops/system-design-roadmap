/* ===== Tab Job: Full-Stack Developer (Node.js · React.js · Next.js) — ONE Tech Stop Vietnam ===== */
window.JOB = {
id: 'ots-fullstack',
title: 'Full-Stack Developer (Node.js · React.js · Next.js)',
company: 'ONE Tech Stop Vietnam (OTSV)',
location: 'TP. Hồ Chí Minh · Full time · từ 3 năm kinh nghiệm · Cử nhân',
url: 'https://ots.one-line.com/vi/careers/full-stack-developer-node-js-react-js-next-js-lpwkp263txdw3fj',

overview: `
### JD nói gì (diễn giải ngắn)
| Nhóm | Nội dung | Mức |
|---|---|---|
| Backend | Node.js + TypeScript, framework NestJS (1–3 năm) | Bắt buộc |
| Frontend | HTML/CSS/JS, Next.js hoặc React | Bắt buộc |
| Database | Quan hệ (SQL) và phi quan hệ (MongoDB, Redis, Cassandra): lập trình và thiết kế | Bắt buộc |
| Chất lượng code | Có tài liệu, theo good practice; test unit, integration, UAT, automation regression | Bắt buộc |
| API | RESTful API | Bắt buộc |
| Nền tảng | Nguyên lý lập trình, design pattern | Bắt buộc |
| Thái độ | Sẵn sàng học công nghệ mới, product mindset | Bắt buộc |
| Cloud | Kiến trúc/hạ tầng cloud, đặc biệt GCP | Ưu tiên |
| DevOps | Docker; CI/CD | Ưu tiên |
| Quy trình | Làm việc Agile | Ưu tiên |

### Việc hằng ngày theo JD
- Tham gia **mọi pha**: phân tích yêu cầu, ước lượng, thiết kế chi tiết, code, test, deploy.
- Làm feature/bug từ backlog; **xử lý sự cố nhanh** khi có.
- **Xây và duy trì CI/CD**; tham gia QA với quy trình, practice và công cụ phân tích.
- Phát triển **yêu cầu phi chức năng**: performance, security, reliability, maintainability.
- Giúp lead định nghĩa **technical backlog**, tham gia **roadmap và quản lý rủi ro**.
- Cam kết kết quả của team; giao tiếp khách quan với đối tác, lead, đồng đội; **feedback** cho team; đề xuất ý tưởng từ xu hướng công nghệ.

### Đọc giữa các dòng
- Đây là vị trí **full-stack thiên backend**: NestJS và database được nhắc chi tiết nhất; frontend chỉ cần Next.js hoặc React.
- Phần trách nhiệm có nhiều việc của mid–senior (NFR, technical backlog, roadmap, rủi ro, feedback). Kinh nghiệm xử lý sự cố và tối ưu hiệu năng thật của bạn là lợi thế lớn nhất; hãy để nó dẫn dắt câu chuyện.
- "Fail quick, success quick", Agile, open office: họ chấm cả **cách bạn học và nhận lỗi**. Chuẩn bị một câu chuyện sai lầm có bài học rõ.
- Testing được liệt kê tới 4 tầng (unit, integration, UAT, automation regression): gần như chắc chắn có câu hỏi về chiến lược test và có thể có bài tập kèm test.
- Cassandra xuất hiện trong danh sách NoSQL: khả năng có hệ dữ liệu sự kiện khối lượng lớn (ví dụ theo dõi container). Ôn mô hình hoá theo partition key là đủ.
- GCP được ưu tiên trong khi bạn quen AWS: chuẩn bị bảng ánh xạ dịch vụ và một câu trả lời "đã chạy thử trên GCP".

### Vòng phỏng vấn nên chuẩn bị (giả định phổ biến, hãy hỏi HR để chốt)
| Vòng | Nội dung thường gặp | Chuẩn bị trong tab này |
|---|---|---|
| HR / screening | Giới thiệu bản thân, lý do đổi việc, mong muốn | Phần Chuẩn bị: pitch 90 giây, câu hỏi hỏi lại |
| Technical 1 | Hỏi nhanh Node/TS, React/Next, DB, test, REST | Câu hỏi nhanh JQ1–JQ70, bài J1–J7 |
| Technical 2 / coding | Live coding hoặc bài về nhà (API NestJS + UI) | Dự án luyện tay, bài J3, J6 |
| System design | Thiết kế một hệ thống theo nghiệp vụ | Mock JM1–JM4 + case C1–C19 của lộ trình |
| Manager / behavioral | Sự cố, NFR, backlog, feedback, làm việc nhóm | Behavioral (10 câu gắn với JD), bài J10 |
`,

domain: `
### Bối cảnh công ty (tự kiểm tra lại trên website trước buổi phỏng vấn)
ONE (Ocean Network Express) là hãng tàu container quốc tế, hình thành từ việc hợp nhất mảng container của ba hãng Nhật NYK, MOL và K Line; trụ sở chính ở Singapore. ONE Tech Stop là đơn vị công nghệ phát triển hệ thống số hoá nghiệp vụ của hãng. Kinh nghiệm làm việc với khách Nhật của bạn là điểm cộng tự nhiên: nhắc nó trong phần giới thiệu.

### Nghiệp vụ cốt lõi của hãng tàu container
| Quy trình | Mô tả ngắn | Dữ liệu và thách thức kỹ thuật |
|---|---|---|
| Lịch tàu (schedule) | Tuyến, chuyến (voyage), cảng ghé, ETA/ETD | Đọc rất nhiều, đổi thường xuyên khi tàu trễ; hợp với cache + ISR |
| Báo giá & booking | Khách đặt chỗ container trên chuyến tàu | Sức chứa giới hạn (TEU), tranh chấp đồng thời, giữ chỗ có hạn, overbooking có chủ đích, idempotency |
| Chứng từ | Shipping Instruction (SI), Bill of Lading (B/L), VGM | Quy trình nhiều bước, phê duyệt, phiên bản, audit; sinh PDF |
| Theo dõi container | Sự kiện gate-in, loaded, departed, transshipment, discharged, gate-out | Khối lượng lớn, sự kiện trùng và lệch thứ tự, nhiều nguồn (terminal, EDI, đối tác) |
| Thông báo | Báo khách khi ETA đổi, container tới cảng | Fan-out theo người đăng ký, nhiều kênh (email, webhook, portal), gom thông báo |
| Tích hợp | Trao đổi EDI/API với terminal, đại lý, khách lớn | Định dạng cũ, retry, đối soát, schema evolution |
| Phí lưu container | Demurrage & Detention (D&D) | Tính tiền theo ngày, quy tắc phức tạp theo hợp đồng: hợp pattern Strategy |

### Thuật ngữ nghiệp vụ nên biết
| Thuật ngữ | Nghĩa |
|---|---|
| TEU / FEU | Đơn vị container 20 feet / 40 feet; sức chứa tàu tính bằng TEU |
| POL / POD | Cảng xếp hàng (Port of Loading) / cảng dỡ hàng (Port of Discharge) |
| ETA / ETD | Thời gian dự kiến tới / rời cảng |
| Voyage | Một chuyến của tàu trên tuyến, có mã chuyến |
| Booking | Yêu cầu đặt chỗ cho container trên một chuyến |
| SI | Shipping Instruction: thông tin chi tiết hàng để lập vận đơn |
| B/L | Bill of Lading: vận đơn, chứng từ sở hữu hàng |
| VGM | Verified Gross Mass: khối lượng container đã xác nhận, bắt buộc trước khi xếp tàu |
| Transshipment | Chuyển tải: container đổi tàu ở cảng trung gian |
| Reefer | Container lạnh, có dữ liệu nhiệt độ liên tục |
| D&D | Demurrage & Detention: phí lưu container ở cảng / ngoài cảng quá hạn |
| EDI | Trao đổi dữ liệu điện tử chuẩn UN/EDIFACT, ví dụ IFTSTA (trạng thái), IFTMBF (booking), CODECO (gate-in/out) |

### Cách dùng nghiệp vụ trong phỏng vấn
- Khi được hỏi system design chung (notification, tracking, booking), **đặt ví dụ vào nghiệp vụ hãng tàu**: người phỏng vấn sẽ thấy bạn đã tìm hiểu.
- Không giả vờ biết nội bộ của họ. Câu an toàn: "I assumed a container produces around N events per voyage; please correct me if your numbers are different."
- Hỏi lại về sản phẩm cụ thể của team: customer portal, hệ thống nội bộ cho đại lý, hay tích hợp.
`,

matrix: [
  { req: 'Node.js + TypeScript (1–3 năm)', must: 1, have: 'Dự án cá nhân dcn_toolbox viết bằng TypeScript (nhiều service NestJS); FE Next.js của dự án SBOM. Ngôn ngữ chính 5 năm là Go.', gap: 2, todo: 'Nói trôi chảy event loop, async, streams, xử lý lỗi; port một endpoint Go sang NestJS để có ví dụ so sánh.', links: ['J1', 'J2'] },
  { req: 'NestJS', must: 1, have: 'dcn_toolbox: nhiều service NestJS độc lập, Postgres schema riêng từng service, đăng nhập mật khẩu + TOTP, socket.io, audit log gộp.', gap: 1, todo: 'Bổ sung guard/interceptor/pipe chuẩn, e2e test với Test.createTestingModule, health check terminus.', links: ['J3', 'J6'] },
  { req: 'HTML/CSS/JS, React hoặc Next.js', must: 1, have: 'Sửa và nâng cấp FE Next.js của SBOM (lỗi crash khi trình duyệt dịch trang, nâng next vì CVE, biến NEXT_PUBLIC bị bake lúc build); web UI của dcn_toolbox.', gap: 2, todo: 'Ôn App Router, Server/Client Components, caching, rendering strategy, state; làm 3 trang portal trong dự án luyện tay.', links: ['J4', 'J5'] },
  { req: 'SQL / database quan hệ', must: 1, have: 'Postgres/Aurora chuyên sâu: partial index, FDW, statement_timeout theo role, bảng 9,6 triệu dòng, tối ưu truy vấn chậm.', gap: 0, todo: 'Chỉ cần kể lại bằng số liệu; ôn transaction isolation và N+1 trong ORM Node.', links: ['F5', 'K3', 'J7'] },
  { req: 'MongoDB, Redis', must: 1, have: 'Cả hai có trong stack SBOM (Redis cache L1 cho enrichment, rate limit; MongoDB và sự cố pin version).', gap: 1, todo: 'Ôn mô hình hoá Mongo (embed vs reference, index compound, aggregation) và các pattern Redis.', links: ['J7', 'F7'] },
  { req: 'Cassandra', must: 1, have: 'Chưa dùng.', gap: 3, todo: 'Học mô hình query-first, partition key + bucket, clustering order, consistency level; làm bài mô hình hoá sự kiện container.', links: ['J7', 'B4', 'C7'] },
  { req: 'Test: unit, integration, UAT, automation regression', must: 1, have: 'Tự điền: test bạn đã viết ở SBOM (Go test), regression phát hiện sau merge nhánh (fix bị mất khi merge).', gap: 2, todo: 'Jest/Vitest, Supertest, Testcontainers, React Testing Library, Playwright; viết một bộ regression nhỏ chạy trong CI.', links: ['J6', 'K8'] },
  { req: 'RESTful API', must: 1, have: 'Thiết kế và vận hành apiserver Go nhiều endpoint, export, pagination, multi-tenant.', gap: 0, todo: 'Ôn OpenAPI/Swagger trong Nest, idempotency key, error contract.', links: ['F6'] },
  { req: 'Nguyên lý lập trình, design pattern', must: 1, have: 'Kinh nghiệm thực tế với retry, circuit breaker, outbox, strategy trong xử lý license/vulnerability.', gap: 1, todo: 'Chuẩn bị 3 pattern có ví dụ thật bằng TypeScript; ôn SOLID theo cách NestJS áp dụng.', links: ['J9', 'K4'] },
  { req: 'Code có tài liệu, good practice', must: 1, have: 'Viết postmortem, phân tích root cause chi tiết cho ticket; lộ trình này có mẫu ADR/design doc.', gap: 1, todo: 'TSDoc, README, ADR, Swagger tự sinh; mang một ADR mẫu đi phỏng vấn.', links: ['J9', 'K11'] },
  { req: 'Xây và duy trì CI/CD', must: 0, have: 'Deploy bằng docker compose + Watchtower; tự đẩy app này lên GitHub Pages.', gap: 2, todo: 'Tự viết pipeline GitHub Actions đầy đủ cho dự án luyện tay (lint, test, build image, deploy).', links: ['J8', 'B18'] },
  { req: 'Docker', must: 0, have: 'Vận hành nhiều stack compose trên EC2, debug container OOM, hairpin NAT, pin image.', gap: 0, todo: 'Dockerfile multi-stage cho NestJS và Next.js standalone.', links: ['J8'] },
  { req: 'Cloud, đặc biệt GCP', must: 0, have: 'AWS: Lambda, Aurora, S3, EC2.', gap: 2, todo: 'Bảng ánh xạ AWS → GCP; deploy dự án luyện tay lên Cloud Run (free tier) để có trải nghiệm thật.', links: ['J8', 'K7'] },
  { req: 'Agile', must: 0, have: 'Làm việc theo backlog với khách Nhật, triage ticket, ước lượng độ khó.', gap: 0, todo: 'Chuẩn bị ví dụ ước lượng sai và cách điều chỉnh.', links: ['J10'] },
  { req: 'Xử lý sự cố nhanh', must: 1, have: 'Thế mạnh: publisher RabbitMQ chết im lặng, worker OOM, pilot 55% request lỗi, enrichment kẹt, lịch quét lỡ tick.', gap: 0, todo: 'Chuẩn bị 2 câu chuyện 90 giây có số liệu và hành động phòng ngừa.', links: ['K10', 'J10'] },
  { req: 'Yêu cầu phi chức năng (performance, security, reliability, maintainability)', must: 1, have: 'Kiểm chứng hiệu năng pilot theo SLA, partial index giảm truy vấn từ phút xuống ms, timeout, giới hạn bộ nhớ.', gap: 0, todo: 'Diễn đạt NFR thành số đo được (p95, SLO, error budget).', links: ['F9', 'B17', 'J10'] },
  { req: 'Technical backlog, roadmap, quản lý rủi ro', must: 1, have: 'Triage và ước lượng độ khó nhiều ticket, phân tích root cause, đề xuất hướng sửa cho lead.', gap: 1, todo: 'Học cách ưu tiên nợ kỹ thuật theo rủi ro × chi phí, risk register.', links: ['J10', 'K11'] },
  { req: 'Giao tiếp, feedback cho team', must: 1, have: 'Báo cáo phân tích cho khách Nhật và lead; review merge tìm fix bị mất.', gap: 1, todo: 'Chuẩn bị câu chuyện feedback theo khung SBI.', links: ['K9', 'J10'] },
  { req: 'Học công nghệ mới, product mindset', must: 1, have: 'Tự xây dcn_toolbox, các app học tập (IELTS, system design) và deploy.', gap: 0, todo: 'Nhắc ngắn gọn trong phần giới thiệu, đừng kể dài.', links: ['K12'] }
],

plan: [
  { w: 1, title: 'Node.js và TypeScript như ngôn ngữ chính', goal: 'Trả lời trôi chảy 12 câu node trong Câu hỏi nhanh; có một endpoint NestJS port từ Go.', tasks: [
    'Học J1 Node.js runtime, làm quiz ≥ 7/8',
    'Học J2 TypeScript cho backend, bật strict cho một service dcn_toolbox và sửa hết lỗi',
    'Viết lại một endpoint Go quen thuộc (ví dụ list có cursor pagination) bằng NestJS + TypeScript, so sánh độ dài và cách xử lý lỗi',
    'Đo event loop lag của service đó khi chạy một vòng lặp CPU 2 giây; ghi số vào Sổ tay',
    'Câu hỏi nhanh: toàn bộ topic Node, nói to, tự chấm',
    'Viết pitch 90 giây bằng tiếng Anh (phần Chuẩn bị), ghi âm và nghe lại'
  ]},
  { w: 2, title: 'NestJS production và testing', goal: 'Dự án luyện tay có API NestJS chạy được, có unit + integration test.', tasks: [
    'Học J3 NestJS, vẽ lại vòng đời request từ trí nhớ',
    'Học J6 chiến lược test',
    'Dự án luyện tay bước 1–3: khởi tạo NestJS, module booking + tracking, Postgres qua Docker',
    'Viết unit test cho service và e2e test với Supertest + Testcontainers',
    'Câu hỏi nhanh: topic api, testing, design',
    'Behavioral: viết câu chuyện sự cố và câu chuyện chất lượng (2 câu đầu của phần Behavioral)'
  ]},
  { w: 3, title: 'React, Next.js và dữ liệu', goal: 'Portal Next.js 3 trang chạy với API; mô hình Cassandra cho sự kiện container.', tasks: [
    'Học J4 React và J5 Next.js App Router',
    'Học J7 bốn loại database, làm bài mô hình hoá sự kiện container trong Cassandra',
    'Dự án luyện tay bước 4–6: trang lịch tàu (ISR), trang tracking (dynamic), dashboard (client) + component test',
    'Câu hỏi nhanh: topic frontend, db',
    'Mock JM1 track & trace (lạnh, 45 phút), tự chấm, đọc reference',
    'Behavioral: câu chuyện NFR và câu chuyện học nhanh'
  ]},
  { w: 4, title: 'CI/CD, GCP, pattern, mock và behavioral', goal: 'Pipeline CI/CD xanh, deploy Cloud Run; 3 mock còn lại; tổng duyệt.', tasks: [
    'Học J8 CI/CD + Docker + GCP, J9 design pattern, J10 NFR và Agile',
    'Dự án luyện tay bước 7–9: GitHub Actions, Dockerfile multi-stage, deploy Cloud Run, Playwright smoke test',
    'Mock JM2 booking và JM3 thông báo ETA (mỗi đề 45 phút)',
    'Mock JM4 portal Next.js + BFF NestJS',
    'Behavioral: hoàn thiện 10 câu, tập kể mỗi câu dưới 2 phút',
    'Tổng duyệt: Câu hỏi nhanh 20 câu ngẫu nhiên + 1 mock + 3 behavioral liền nhau như buổi thật; đọc checklist ngày phỏng vấn'
  ]}
],

project: {
  title: 'Dự án luyện tay: Mini Track & Trace (NestJS + Next.js)',
  why: 'Một dự án nhỏ đúng nghiệp vụ và đúng stack của JD cho bạn: kinh nghiệm Node/Nest/Next thật để kể, câu trả lời cho câu hỏi "show me some code", và chất liệu cho mock system design. Giữ phạm vi nhỏ, làm xong trong 3 tuần buổi tối.',
  stack: 'NestJS 10+ · TypeScript strict · Postgres (booking, schedule) · MongoDB hoặc Cassandra (sự kiện container) · Redis (cache, rate limit) · Next.js App Router · Jest/Vitest · Supertest + Testcontainers · Playwright · Docker · GitHub Actions · Cloud Run',
  steps: [
    'Khởi tạo monorepo hai app (api NestJS, web Next.js), bật TypeScript strict, ESLint, Prettier; README có sơ đồ kiến trúc.',
    'Module schedule: CRUD voyage và port call (POL/POD, ETA/ETD); endpoint list có cursor pagination; validate DTO bằng class-validator; Swagger tự sinh.',
    'Module booking: tạo booking idempotent (header Idempotency-Key), kiểm tra sức chứa TEU bằng optimistic locking (cột version), trạng thái pending → confirmed → cancelled; unit test service và e2e test bằng Testcontainers Postgres.',
    'Module tracking: endpoint nhận sự kiện container (gate-in, loaded, departed, discharged, gate-out), dedup theo event id, lưu theo container_id và thời gian; truy vấn timeline; cache kết quả bằng Redis với TTL ngắn.',
    'Thông báo: khi ETA của voyage đổi, ghi outbox trong cùng transaction rồi một worker gửi webhook giả lập cho booking bị ảnh hưởng, có retry và DLQ.',
    'Web: trang lịch tàu public dùng ISR revalidate 5 phút; trang tracking theo số container (server component, dynamic); dashboard booking có đăng nhập (client component, TanStack Query).',
    'Chất lượng: component test bằng React Testing Library cho form booking; Playwright smoke test luồng tạo booking → xem tracking.',
    'CI/CD: GitHub Actions chạy lint, type-check, unit, integration (service container Postgres), build image multi-stage, push Artifact Registry hoặc GHCR.',
    'Deploy Cloud Run (api và web), secret qua Secret Manager, health check terminus, log JSON; ghi lại 3 vấn đề gặp phải vào Sổ tay để kể trong phỏng vấn.'
  ],
  accept: [
    'Tạo booking lặp lại cùng Idempotency-Key trả cùng kết quả, không tạo bản ghi mới.',
    'Hai request đồng thời vượt sức chứa: đúng một request thành công, request kia nhận lỗi 409.',
    'Sự kiện tracking gửi trùng hai lần chỉ lưu một bản; sự kiện đến lệch thứ tự vẫn hiện đúng timeline.',
    'Pipeline CI xanh trên pull request; deploy được lên Cloud Run bằng một lệnh hoặc một merge.',
    'Có README, Swagger, ít nhất một ADR giải thích lựa chọn database cho sự kiện tracking.'
  ]
},

behavioral: [
  { q: 'Tell me about a production incident you handled. What did you do in the first 30 minutes?', vi: 'Kể một sự cố production bạn đã xử lý. 30 phút đầu bạn làm gì?', jd: 'Xử lý sự cố nhanh', story: 'Publisher RabbitMQ không tự kết nối lại sau khi broker bị recreate, mọi job định kỳ im lặng nhiều ngày; hoặc pilot 55% request lỗi do bảng 9,6 triệu dòng thiếu index.', points: ['Phát hiện thế nào và vì sao phát hiện muộn', 'Giảm nhẹ trước (restart, tắt job nặng), sửa gốc sau', 'Số liệu trước/sau', 'Phòng ngừa: alert "không có thành công trong N phút", reconnect, test chaos'], avoid: 'Kể lan man kỹ thuật mà không nói tác động tới người dùng và bài học.' },
  { q: 'Describe a time you improved performance or reliability of a system.', vi: 'Kể lần bạn cải thiện hiệu năng hoặc độ tin cậy.', jd: 'Yêu cầu phi chức năng', story: 'Partial index cho hàng đợi pending giảm truy vấn từ hàng phút xuống mili giây; hoặc worker OOM 5 GiB do load toàn bộ dữ liệu, sửa bằng phân trang và giới hạn bộ nhớ.', points: ['Đo trước khi sửa', 'Nguyên nhân gốc chứ không chỉ triệu chứng', 'Con số trước/sau', 'Cách giữ cho nó không tái diễn (dashboard, test tải)'], avoid: 'Nói "tôi tối ưu code" mà không có số.' },
  { q: 'How do you make sure a release does not break existing features?', vi: 'Làm sao bạn bảo đảm bản phát hành không làm hỏng tính năng cũ?', jd: 'QA, automation regression test', story: 'Lần audit merge nhánh phát hiện một số fix frontend bị mất âm thầm và lỗi cũ quay lại trên môi trường test.', points: ['Phát hiện bằng cách nào', 'Đề xuất: regression test tự động cho các bug đã sửa, checklist merge, chạy suite trong CI', 'Bạn học được gì về quy trình'], avoid: 'Đổ lỗi cho người merge.' },
  { q: 'How do you decide which technical debt to work on?', vi: 'Bạn chọn nợ kỹ thuật nào để trả trước như thế nào?', jd: 'Technical backlog, roadmap', story: 'Triage nhiều ticket với độ khó và root cause, đề xuất thứ tự cho lead.', points: ['Rủi ro × tần suất × chi phí sửa', 'Gắn với sự cố hoặc chỉ số đo được', 'Viết ticket kỹ thuật có acceptance criteria', 'Thương lượng với PO bằng tác động nghiệp vụ'], avoid: 'Nói "tôi refactor những gì tôi thấy xấu".' },
  { q: 'Tell me about a disagreement with a client, product owner or senior engineer.', vi: 'Kể một lần bất đồng với khách hàng, PO hoặc kỹ sư senior.', jd: 'Giao tiếp khách quan với đối tác và lead', story: 'Một yêu cầu tính năng đi ngược quyết định đã chốt trước đó (ví dụ cách sắp xếp phiên bản), hoặc khách đổi hướng giữa chừng.', points: ['Hiểu lý do của bên kia', 'Đưa dữ liệu và phương án, không đưa ý kiến', 'Ai quyết và quyết thế nào', 'Kết quả và quan hệ sau đó'], avoid: 'Kể như mình thắng cuộc tranh luận.' },
  { q: 'Give an example of feedback you gave to a teammate.', vi: 'Kể một lần bạn góp ý cho đồng đội.', jd: 'Feedback cho team', story: 'Tự điền: một lần review code hoặc phân tích sự cố bạn góp ý về cách làm (thiếu timeout, publish trước commit, thiếu test).', points: ['Khung SBI: tình huống, hành vi, tác động', 'Riêng tư, cụ thể, kịp thời', 'Đề xuất cách làm khác', 'Theo dõi sau đó'], avoid: 'Feedback chung chung kiểu "code cần sạch hơn".' },
  { q: 'Tell me about a mistake you made in production and what you learned.', vi: 'Kể một sai lầm của bạn trên production và bài học.', jd: 'Văn hoá "fail quick, success quick"', story: 'Chạy migrate trên môi trường pilot làm hỏng kết nối FDW tới DB khác; phải khôi phục tay theo môi trường chuẩn.', points: ['Nhận trách nhiệm ngay câu đầu', 'Khoanh vùng và khôi phục', 'Thay đổi quy trình để người khác không mắc lại (runbook, cảnh báo trong tài liệu)'], avoid: 'Chọn "sai lầm" giả như "tôi quá cầu toàn".' },
  { q: 'Tell me about a time you had to learn a new technology quickly.', vi: 'Kể lần bạn phải học công nghệ mới thật nhanh.', jd: 'Sẵn sàng học công nghệ mới', story: 'Tự xây dcn_toolbox bằng NestJS dù ngôn ngữ chính là Go; hoặc xử lý nâng cấp Next.js khi có CVE nghiêm trọng.', points: ['Vì sao cần học', 'Cách học (tài liệu gốc, làm dự án nhỏ, đọc mã nguồn)', 'Kết quả cụ thể', 'Bạn chuyển kiến thức Go sang Node như thế nào'], avoid: 'Chỉ liệt kê khoá học.' },
  { q: 'Your estimate was wrong. What happened and what did you do?', vi: 'Ước lượng của bạn sai. Chuyện gì đã xảy ra và bạn làm gì?', jd: 'Ước lượng, cam kết kết quả của team', story: 'Tự điền: một ticket tưởng nhỏ nhưng gốc là vấn đề kiến trúc (ví dụ lỗi enrichment hoá ra do một phần tử xấu làm hỏng cả batch).', points: ['Phát hiện lệch sớm và báo sớm', 'Chia nhỏ, đưa phương án tạm', 'Điều chỉnh cách ước lượng sau đó (spike, khoảng tin cậy)'], avoid: 'Im lặng tới hạn chót.' },
  { q: 'Why OTSV, and why a full-stack Node.js role after five years of Go?', vi: 'Vì sao OTSV và vì sao chuyển sang full-stack Node.js sau 5 năm Go?', jd: 'Động lực, product mindset', story: 'Muốn làm sản phẩm có người dùng thật ở quy mô lớn, sở hữu cả backend và giao diện; đã làm Next.js và NestJS song song với Go; quen làm việc với doanh nghiệp Nhật.', points: ['Một câu về sản phẩm/nghiệp vụ của họ', 'Kinh nghiệm backend sâu là nền cho full-stack', 'Bằng chứng đã chủ động học Node/Nest/Next', 'Mục tiêu 2–3 năm khớp với vị trí'], avoid: 'Nói xấu công ty hiện tại; chỉ nói về lương.' }
],

pitch: `
### Giới thiệu bản thân 90 giây (khung, tự điền số liệu thật)
> Hi, I'm [tên]. I'm a backend engineer with about five years of experience, mostly in Go, building a multi-tenant SaaS platform for software supply-chain analysis for a Japanese client. I work across the stack: REST APIs and background workers, Postgres, Redis, RabbitMQ and MongoDB, deployment with Docker on AWS, and I also maintain parts of our Next.js front end.

> What I'm most proud of is the reliability work. For example, [một sự cố + con số trước/sau]. That taught me to design for failure: timeouts, idempotent consumers, and alerts that catch silent failures.

> On the Node.js side, I built [dcn_toolbox] as a set of NestJS services with TypeScript, and recently [dự án luyện tay track & trace]. I'm applying to OTSV because I want to own full-stack features on a product used at global scale, and container logistics is a domain where reliability and data correctness really matter.

### Mẹo
- Dừng ở 90 giây. Người phỏng vấn sẽ hỏi tiếp phần họ quan tâm.
- Mỗi đoạn một ý: bạn là ai, bạn giỏi gì (có số), vì sao vị trí này.
- Tập bằng ghi âm; đếm số lần "um". Dưới 3 lần là ổn.
`,

ask: [
  'Team này phụ trách sản phẩm nào: cổng khách hàng, hệ thống nội bộ, hay tích hợp với đối tác? Người dùng chính là ai?',
  'Tỉ lệ công việc backend và frontend thực tế của vị trí này là bao nhiêu?',
  'Hệ thống chạy trên GCP như thế nào: Cloud Run, GKE hay máy ảo? Ai sở hữu pipeline CI/CD?',
  'Team xử lý sự cố ra sao: có on-call không, có postmortem không?',
  'Văn hoá test hiện tại: tỉ lệ automation regression, ai viết UAT?',
  'Một sprint điển hình trông thế nào, và kỹ sư tham gia technical backlog, roadmap ở mức nào?',
  'Team làm việc với trụ sở hoặc team ở nước khác thế nào (múi giờ, ngôn ngữ)?',
  'Sau 6 tháng, điều gì cho thấy người vào vị trí này thành công?'
],

checklist: [
  'Đọc lại JD và phần "Đọc giữa các dòng"; chọn 3 điểm mạnh muốn người phỏng vấn nhớ.',
  'Tập pitch 90 giây hai lần, ghi âm một lần.',
  'Ôn bảng thuật ngữ nghiệp vụ hãng tàu (TEU, POL/POD, B/L, ETA).',
  'Mở sẵn dự án luyện tay và một ADR để chia sẻ màn hình nếu được hỏi.',
  'Chuẩn bị Excalidraw hoặc giấy bút cho system design; thử vẽ sơ đồ JM1 trong 3 phút.',
  'Kiểm tra mic, camera, mạng, link họp 15 phút trước (nếu online).',
  'Chuẩn bị 3 câu hỏi hỏi lại trong danh sách; viết sẵn ra giấy.',
  'Sau buổi: ghi lại câu hỏi đã gặp và câu trả lời chưa tốt vào Sổ tay trong vòng 1 giờ.'
]
};

/* Thuật ngữ nghiệp vụ hãng tàu: thêm vào bảng thuật ngữ chung */
window.GLOSSARY = (window.GLOSSARY || []).concat([
{ term: 'TEU', alt: ['FEU', 'twenty-foot equivalent unit'], vi: 'Đơn vị container 20 feet', topic: 'shipping', def: 'Đơn vị đo container quy về loại 20 feet; container 40 feet là 2 TEU (FEU). Sức chứa tàu và hạn mức booking tính bằng TEU, nên kiểm tra sức chứa là bài toán tranh chấp đồng thời.', see: ['J7'] },
{ term: 'ETA', alt: ['ETD', 'estimated time of arrival'], vi: 'Thời gian dự kiến tới / rời', topic: 'shipping', def: 'Thời điểm dự kiến tàu tới (ETA) hoặc rời (ETD) cảng. Thay đổi thường xuyên khi tàu trễ; mỗi lần đổi có thể phải báo cho rất nhiều khách có hàng trên chuyến.', see: ['J7'] },
{ term: 'POL', alt: ['POD', 'port of loading', 'port of discharge'], vi: 'Cảng xếp / cảng dỡ', topic: 'shipping', def: 'POL là cảng container được xếp lên tàu, POD là cảng dỡ xuống. Một booking đi từ POL tới POD, có thể qua cảng chuyển tải ở giữa.', see: ['J7'] },
{ term: 'Bill of Lading', alt: ['B/L', 'BL'], vi: 'Vận đơn', topic: 'shipping', def: 'Chứng từ hãng tàu phát hành xác nhận đã nhận hàng, là hợp đồng vận chuyển và chứng từ sở hữu hàng. Có quy trình duyệt, nhiều phiên bản và cần audit đầy đủ.', see: ['J9'] },
{ term: 'Shipping Instruction', alt: ['SI'], vi: 'Hướng dẫn gửi hàng', topic: 'shipping', def: 'Thông tin chi tiết người gửi cung cấp sau khi booking (hàng hoá, người nhận, số container) để hãng tàu lập vận đơn.', see: ['J9'] },
{ term: 'VGM', alt: ['verified gross mass'], vi: 'Khối lượng toàn bộ đã xác nhận', topic: 'shipping', def: 'Khối lượng container đã được cân xác nhận, bắt buộc theo quy định an toàn hàng hải trước khi xếp lên tàu. Thiếu VGM là container không được xếp.', see: ['J7'] },
{ term: 'transshipment', alt: ['chuyển tải'], vi: 'Chuyển tải', topic: 'shipping', def: 'Container được dỡ ở cảng trung gian rồi xếp lên tàu khác để tới đích. Tạo thêm sự kiện tracking và rủi ro lỡ chuyến nối.', see: ['J7'] },
{ term: 'reefer', alt: ['reefer container'], vi: 'Container lạnh', topic: 'shipping', def: 'Container có máy lạnh cho hàng cần nhiệt độ; phát dữ liệu nhiệt độ liên tục, là nguồn dữ liệu chuỗi thời gian khối lượng lớn.', see: ['J7'] },
{ term: 'Demurrage & Detention', alt: ['D&D', 'demurrage', 'detention'], vi: 'Phí lưu container', topic: 'shipping', def: 'Phí khi container nằm ở cảng (demurrage) hoặc ở ngoài cảng (detention) quá số ngày miễn phí. Quy tắc tính khác nhau theo hợp đồng và cảng: ví dụ điển hình cho pattern Strategy.', see: ['J9'] },
{ term: 'EDI', alt: ['EDIFACT', 'IFTSTA', 'CODECO', 'IFTMBF'], vi: 'Trao đổi dữ liệu điện tử', topic: 'shipping', def: 'Trao đổi chứng từ giữa hệ thống các bên theo chuẩn UN/EDIFACT (IFTSTA trạng thái vận chuyển, IFTMBF booking, CODECO gate-in/gate-out). Định dạng cũ, cần parser theo đối tác, retry và đối soát.', see: ['J9', 'J7'] },
{ term: 'voyage', alt: ['vessel schedule', 'port call'], vi: 'Chuyến tàu', topic: 'shipping', def: 'Một chuyến của tàu trên tuyến với danh sách cảng ghé (port call) và ETA/ETD từng cảng. Lịch tàu được đọc rất nhiều và đổi thường xuyên: hợp với cache và ISR.', see: ['J5', 'J7'] },
{ term: 'track and trace', alt: ['track & trace', 'container tracking'], vi: 'Theo dõi container', topic: 'shipping', def: 'Tra cứu chuỗi sự kiện của container (gate-in, loaded, departed, discharged, gate-out) theo số container, booking hoặc vận đơn. Dữ liệu từ nhiều nguồn, có sự kiện trùng và lệch thứ tự.', see: ['J7'] }
]);
