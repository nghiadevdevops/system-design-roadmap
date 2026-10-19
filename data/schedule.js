/* ===== Lộ trình 24 tuần · lịch tuần · rubric mock · tổng quan ===== */
window.PRINCIPLES = `
1. **Nền trước, bài mẫu sau.** 5 tuần đầu không học thuộc lời giải nào. Bài mẫu chỉ có giá trị khi bạn tự giải được 60% rồi mới so.
2. **Mọi khái niệm phải đi kèm một con số và một trade-off.** Không nói "dùng cache cho nhanh"; nói "cache-aside, TTL 5 phút, hit rate kỳ vọng 90%, chấp nhận dữ liệu cũ tối đa 5 phút".
3. **Mock lạnh trước, đọc case sau.** Thứ Hai làm đề 45 phút không gợi ý, thứ Ba mới đọc lời giải và ghi 3 khác biệt. Đọc trước rồi làm là tự lừa mình.
4. **Nói to.** Phỏng vấn chấm cách bạn dẫn dắt, không chấm sơ đồ đẹp. Ghi âm 10 phút tóm tắt thiết kế mỗi tuần, nghe lại.
5. **Áp dụng vào công việc trong tuần.** Mỗi bài có mục "Áp dụng vào hệ thống SBOM của bạn". Thứ Sáu chọn một việc: đo một metric, thêm một timeout, viết một ADR. Ghi vào Sổ tay thiết kế.
6. **Ôn ngắt quãng.** Flashcard 10–15 phút mỗi ngày (Leitner 5 hộp). Số liệu không ôn sau 7 ngày coi như chưa học.
7. **Sổ tay là tài sản.** Mọi quyết định, sự cố, bài học ghi vào Sổ tay theo mẫu. Đây chính là kho câu chuyện STAR cho vòng behavioral và là design doc nháp cho công việc.
`;

window.PHASE_OVERVIEW = `
| Giai đoạn | Tuần | Mục tiêu | Đầu ra đo được | Giờ/tuần |
|---|---|---|---|---|
| 1. Nền tảng | 1–5 | Số liệu, ước lượng, mạng, OS, DB, API, cache, queue, độ tin cậy, mở rộng | KT1 ≥ 21/30; 4 lab xong; thẻ D1–D2 ≥ 80% ở hộp ≥ 3 | 8–10 |
| 2. Khối xây dựng | 6–13 | 20 building block: replication, sharding, consistency, consensus, giao dịch phân tán, broker, rate limit, ID, search, storage, data, observability, security, microservices, resilience, deploy, multi-tenant, realtime | KT2 ≥ 22/30; 4 mock lạnh trung bình ≥ 8/15; 6 lab | 9–11 |
| 3. Bài toán kinh điển | 14–20 | 19 case study (gồm bài SBOM của chính bạn); mỗi tuần 1 mock lạnh + đọc 3 case + làm lại | KT3 ≥ 24/30; mock trung bình ≥ 10/15; M1 làm lại hơn baseline ≥ 4 điểm | 9–11 |
| 4. Phỏng vấn & thực chiến | 21–24 | Go, concurrency, SQL, LLD, networking, OS, cloud, testing, behavioral, postmortem, design doc; 6 đề lạ | KT4 ≥ 26/30; đề lạ trung bình ≥ 11/15; 6 câu chuyện STAR viết xong | 10–12 |

**Tuần 1 bắt buộc có baseline:** làm KT0 (30 phút) và mock M1 (URL shortener) **lạnh, không mở gợi ý**, lưu kết quả. Tuần 14 làm lại M1 để thấy khoảng cách. Người đã có kinh nghiệm: KT0 ≥ 22/30 thì có thể lướt Giai đoạn 1 trong 2 tuần (đọc "Cốt lõi" + làm quiz, bỏ qua bài nào quiz ≥ 7/8), nhưng vẫn làm đủ lab L2–L4.

**Điều kiện chuyển giai đoạn** ghi ở cột "Đầu ra đo được". Không đạt thì kéo dài 1–2 tuần, không bỏ bài. Mọi thứ trong app chạy offline, tiến độ lưu trong trình duyệt; xuất JSON ở trang Cài đặt mỗi tuần.
`;

window.RUBRIC = [
  { k: 'req', name: 'Làm rõ yêu cầu & phạm vi', d: ['Nhảy thẳng vào giải pháp, không hỏi gì', 'Hỏi vài câu nhưng không chốt được yêu cầu phi chức năng', 'Chốt rõ chức năng, phi chức năng, ngoài phạm vi', 'Chốt rõ và nêu được thứ tự ưu tiên (ví dụ đúng đắn hơn độ trễ) rồi dùng nó để quyết định ở các pha sau'] },
  { k: 'est', name: 'Ước lượng & số liệu', d: ['Không có con số nào', 'Có QPS nhưng không suy ra được gì', 'QPS, dung lượng, băng thông hợp lý; làm tròn gọn', 'Số liệu dẫn tới quyết định cụ thể (cần shard chưa, cache bao nhiêu GB, bao nhiêu partition)'] },
  { k: 'hld', name: 'Thiết kế tổng thể', d: ['Thiếu thành phần cốt lõi hoặc luồng sai', 'Đủ thành phần nhưng không giải thích luồng đọc/ghi', 'Sơ đồ rõ, API chính, mô hình dữ liệu, luồng đọc/ghi đúng', 'Thiết kế đơn giản nhất đáp ứng yêu cầu; nói rõ vì sao không phức tạp hơn; chỉ ra điểm nghẽn trước khi bị hỏi'] },
  { k: 'deep', name: 'Đào sâu & trade-off', d: ['Chỉ nêu tên công nghệ', 'Nêu 1 phương án, không so sánh', 'So sánh 2–3 phương án, chọn có lý do, nói được failure mode', 'Đào sâu đúng điểm nóng người phỏng vấn quan tâm; nêu cả cách vận hành (monitor, rollback, migration)'] },
  { k: 'comm', name: 'Giao tiếp & dẫn dắt', d: ['Im lặng lâu, lan man, không theo thời gian', 'Nói được nhưng bị động, người phỏng vấn phải kéo', 'Nói to suy nghĩ, xác nhận trước khi đi tiếp, đúng thời gian', 'Dẫn dắt như buổi review thật: tóm tắt từng pha, hỏi ưu tiên, thừa nhận điều chưa chắc và nói cách kiểm chứng'] }
];
window.PHASE_MIN = { req: 5, est: 5, hld: 12, deep: 18, wrap: 5 };
window.PHASE_NAME_VI = { req: 'Làm rõ yêu cầu', est: 'Ước lượng', hld: 'Thiết kế tổng thể', deep: 'Đào sâu', wrap: 'Tổng kết & câu hỏi vặn' };

const W = (w, phase, lessons, extra) => Object.assign({ w, phase, lessons }, extra || {});
window.ROADMAP = [
  W(1, 1, ['F1', 'F2'], { ktest: 'KT0', mocks: ['M1'], cold: true, focus: 'Tư duy thiết kế, số liệu phải thuộc, ước lượng. Baseline: KT0 + mock M1 lạnh (không gợi ý).', milestone: 'Lưu KT0 và M1 làm mốc so sánh cho tuần 14 và 24' }),
  W(2, 1, ['F3', 'F4'], { labs: ['L1'], focus: 'Mạng và hệ điều hành: chi phí của một request từ DNS tới đĩa.' }),
  W(3, 1, ['F5', 'F6'], { labs: ['L2'], focus: 'Cơ sở dữ liệu quan hệ và thiết kế API. Lab: pool, timeout, lock.' }),
  W(4, 1, ['F7', 'F8'], { labs: ['L3'], focus: 'Cache và hàng đợi: hai khối xuất hiện trong mọi bài thiết kế.' }),
  W(5, 1, ['F9', 'F10'], { labs: ['L4'], ktest: 'KT1', focus: 'Độ tin cậy và mở rộng. Checkpoint KT1.', milestone: 'Hết Giai đoạn 1: KT1 ≥ 21/30, 4 lab xong, thẻ D1–D2 ≥ 80% hộp ≥ 3' }),

  W(6, 2, ['B1', 'B2', 'B3'], { focus: 'Load balancer/CDN, replication, sharding.' }),
  W(7, 2, ['B4', 'B5'], { labs: ['L5'], mocks: ['M3'], focus: 'NoSQL/LSM và mô hình nhất quán. Mock lạnh M3 (key-value store) ngay sau khi học consistent hashing + quorum.' }),
  W(8, 2, ['B6', 'B7'], { labs: ['L6'], focus: 'Consensus, lock phân tán, giao dịch phân tán, outbox. Lab outbox.' }),
  W(9, 2, ['B8', 'B9'], { labs: ['L7'], mocks: ['M2'], focus: 'Broker chuyên sâu và rate limiting. Mock lạnh M2 (rate limiter).' }),
  W(10, 2, ['B10', 'B11'], { labs: ['L8'], focus: 'ID, thời gian, thứ tự; tìm kiếm và đánh chỉ mục.' }),
  W(11, 2, ['B12', 'B13', 'B14'], { labs: ['L9'], mocks: ['M5'], focus: 'Object storage, xử lý dữ liệu lớn, observability. Mock lạnh M5 (notification).' }),
  W(12, 2, ['B15', 'B16', 'B17'], { labs: ['L10'], ktest: 'KT2', focus: 'Security, microservices vs monolith, resilience chuyên sâu. Checkpoint KT2.' }),
  W(13, 2, ['B18', 'B19', 'B20'], { mocks: ['M6'], focus: 'Deploy/vận hành, SaaS multi-tenant, realtime. Mock lạnh M6 (news feed).', milestone: 'Hết Giai đoạn 2: KT2 ≥ 22/30, 4 mock trung bình ≥ 8/15, 6 lab' }),

  W(14, 3, ['C1', 'C2', 'C3'], { mocks: ['M1'], labs: ['L11'], focus: 'Làm lại M1 lạnh rồi so với tuần 1. Đọc C1–C3 sau khi làm.', milestone: 'M1 lần 2 hơn baseline ≥ 4 điểm; nếu không, đọc lại F2, F7, B3' }),
  W(15, 3, ['C4', 'C5', 'C6'], { mocks: ['M7'], focus: 'Mock lạnh M7 (chat). Case: ID generator, notification, news feed.' }),
  W(16, 3, ['C7', 'C8', 'C9'], { mocks: ['M10'], focus: 'Mock lạnh M10 (cloud storage). Case: chat, autocomplete, video.' }),
  W(17, 3, ['C10', 'C11', 'C12'], { mocks: ['M11'], focus: 'Mock lạnh M11 (payment). Case: drive, payment, metrics.' }),
  W(18, 3, ['C13', 'C14', 'C15'], { mocks: ['M14'], labs: ['L12'], focus: 'Mock lạnh M14 (proximity). Case: ad aggregation, proximity, message queue. Bắt đầu capstone L12.' }),
  W(19, 3, ['C16', 'C17', 'C18'], { mocks: ['M16', 'M18'], focus: 'Mock lạnh M16 (booking) và M18 (scheduler). Case: booking, crawler, job scheduler.' }),
  W(20, 3, ['C19'], { mocks: ['M19'], ktest: 'KT3', focus: 'Capstone: thiết kế lại hệ SBOM của chính bạn (M19 rồi đọc C19). Hoàn thành L12. Checkpoint KT3.', milestone: 'Hết Giai đoạn 3: KT3 ≥ 24/30, mock trung bình ≥ 10/15, L12 chạy được' }),

  W(21, 4, ['K1', 'K2', 'K3'], { mocks: ['X1', 'X2'], focus: 'Go, concurrency, SQL thực chiến. Hai đề lạ X1, X2.' }),
  W(22, 4, ['K4', 'K5', 'K6'], { mocks: ['X3', 'X4'], focus: 'LLD/OOD, networking, OS. Đề lạ X3, X4.' }),
  W(23, 4, ['K7', 'K8', 'K9', 'K10'], { mocks: ['X5'], focus: 'Cloud, testing, behavioral STAR, postmortem. Đề lạ X5 + làm lại mock điểm thấp nhất.' }),
  W(24, 4, ['K11', 'K12'], { mocks: ['X6'], ktest: 'KT4', focus: 'Design doc/ADR và ngày phỏng vấn. Đề lạ X6 + mô phỏng vòng đầy đủ: KT4 40 phút → mock 45 phút → 6 câu behavioral 30 phút.', milestone: 'Hết lộ trình: KT4 ≥ 26/30, đề lạ trung bình ≥ 11/15, 6 câu chuyện STAR, sổ tay ≥ 20 mục' })
];

/* Lịch trong tuần theo giai đoạn: 0 = Chủ nhật ... 6 = Thứ bảy */
window.WEEKLY_TEMPLATE = {
  1: {
    1: ['Bài học 1 của tuần: đọc "Cốt lõi" 60 phút, làm quiz, ghi 3 ý vào Sổ tay', 'Flashcard 10 phút (bộ D1–D2 trước)'],
    2: ['Hỏi nhanh (Oral) 5 câu, nói to, bấm giờ 2 phút/câu', 'Flashcard 15 phút', 'Quiz bài 1 dưới 7/8 thì đọc lại phần sai và làm lại'],
    3: ['Bài học 2 của tuần + quiz', 'Flashcard 10 phút'],
    4: ['Lab tuần này (2–3 giờ, có thể chia 2 buổi); tick từng bước trong trang Lab'],
    5: ['Oral 5 câu', 'Áp dụng: chọn 1 việc trong mục "Áp dụng vào hệ thống SBOM" làm tại công ty (đo một con số, thêm một timeout, viết một ADR) → ghi Sổ tay'],
    6: ['Drill trộn 20 câu (trang Drill)', 'Flashcard: ôn hết thẻ đến hạn', 'Máy tính ước lượng: tự nghĩ 1 hệ thống và tính QPS/dung lượng trong 10 phút'],
    0: []
  },
  2: {
    1: ['Bài học 1 của tuần + quiz', 'Flashcard 10 phút'],
    2: ['Bài học 2 của tuần + quiz', 'Oral 5 câu theo topic bài 1'],
    3: ['Bài học 3 (nếu có) + quiz; không có thì bắt đầu lab', 'Flashcard 10 phút'],
    4: ['Lab tuần này (2–3 giờ)'],
    5: ['Tuần có mock: làm mock LẠNH 45 phút + tự chấm 15 phút. Tuần không mock: viết design doc 1 trang áp dụng khối vừa học vào hệ SBOM (mẫu ở Hướng dẫn → Dùng vào công việc) → ghi Sổ tay'],
    6: ['Drill trộn 20 câu', 'Flashcard ôn thẻ đến hạn', 'Đọc lại Sổ tay tuần này, viết 1 câu "bài học" cho mỗi mục'],
    0: []
  },
  3: {
    1: ['Mock LẠNH 45 phút đề của tuần, KHÔNG đọc case trước, không mở gợi ý; tự chấm 15 phút và lưu'],
    2: ['Đọc case tương ứng với mock hôm qua; ghi 3 khác biệt lớn nhất giữa bài bạn và lời giải vào Sổ tay', 'Quiz case'],
    3: ['Case thứ 2 của tuần: đọc + quiz; tự vẽ lại sơ đồ từ trí nhớ sau khi đóng bài'],
    4: ['Case thứ 3 của tuần (hoặc lab nếu tuần có lab)'],
    5: ['Làm lại mock đầu tuần bản rút gọn 30 phút (chỉ thiết kế tổng thể + đào sâu) HOẶC ghi âm 10 phút trình bày thiết kế bằng tiếng Anh, nghe lại', 'Áp dụng: 1 việc thật ở công ty → Sổ tay'],
    6: ['Oral 10 câu trộn', 'Flashcard ôn thẻ đến hạn', 'Drill 20 câu'],
    0: []
  },
  4: {
    1: ['Bài K của tuần + quiz', 'Oral 10 câu (ưu tiên topic yếu từ KT gần nhất)'],
    2: ['Mock đề LẠ 45 phút + tự chấm; đọc reference, ghi khác biệt'],
    3: ['Bài K tiếp theo + quiz', 'Viết hoặc tập kể 1 câu chuyện STAR (ghi âm 2 phút)'],
    4: ['Bài K tiếp theo hoặc 3 bài SQL/LLD trong K3/K4'],
    5: ['Mock thứ 2 trong tuần hoặc làm lại mock có điểm thấp nhất', 'Áp dụng: 1 việc thật → Sổ tay'],
    6: ['Tuần có KT: làm KT bấm giờ. Không có: drill 30 câu', 'Flashcard ôn thẻ đến hạn', 'Đọc lại toàn bộ Sổ tay, chọn 6 mục thành câu chuyện STAR'],
    0: []
  }
};

window.ABOUT = `
**System Design Roadmap** là bộ tài liệu tự học 24 tuần cho kỹ sư backend chuẩn bị phỏng vấn system design và kiến thức backend ở mức mid–senior, với mục tiêu kép: qua phỏng vấn và dùng được ngay vào công việc.

Mọi thứ nằm trong trình duyệt: 61 bài học (10 nền tảng, 20 khối xây dựng, 19 case study, 12 kiến thức phỏng vấn), 25 đề mock interview bấm giờ theo 5 pha có rubric, 5 bài test kiến thức, 90 câu hỏi nhanh, hơn 190 flashcard, 12 lab Go, máy tính ước lượng, sổ tay thiết kế. Không có backend; tiến độ lưu trong localStorage, xuất/nhập JSON ở trang này.

Tài liệu tham khảo chính khi soạn: Designing Data-Intensive Applications (Kleppmann), System Design Interview vol. 1–2 (Alex Xu), Site Reliability Engineering (Google), Release It! (Nygard), tài liệu Postgres/Redis/RabbitMQ/Kafka chính thức, và sự cố thật trong hệ thống SBOM của người học.
`;
