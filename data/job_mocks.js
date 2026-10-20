/* ===== JOB_MOCKS: 4 đề mock nghiệp vụ hãng tàu JM1–JM4 cho tab Job OTS Full-stack (không có case đi kèm nên mỗi đề có reference). Mọi con số quy mô là GIẢ ĐỊNH. ===== */
window.MOCKS = window.MOCKS || [];

/* ---------- JM1 ---------- */
window.MOCKS.push({
  id: 'JM1',
  title: 'Design a container track & trace service',
  level: 2,
  prompt: `Design a container track-and-trace service for a shipping line: events arrive from ports, terminals and partners via EDI and APIs, and customers look up a container, booking or Bill of Lading number on our website to see where their cargo is and subscribe to updates.
Thiết kế dịch vụ track & trace container cho hãng tàu: sự kiện đến từ cảng, terminal, đối tác qua EDI và API; khách tra số container, booking hoặc B/L trên website để xem hàng đang ở đâu và đăng ký nhận cập nhật.`,
  clarify: [
    `Hỏi: Sự kiện đến từ đâu, định dạng gì? → Đáp: EDI (X12 315, EDIFACT IFTSTA) qua SFTP/AS2 theo lô 5–15 phút từ khoảng 200 terminal/đối tác; vài terminal gọi API/webhook JSON gần realtime; sự kiện nội bộ từ hệ thống vận hành tàu (load/discharge list).`,
    `Hỏi: Quy mô? → Đáp (giả định): 2 triệu container đang có hành trình, mỗi hành trình ~30 ngày và ~15 sự kiện; đối tác lớn poll API tracking thường xuyên.`,
    `Hỏi: Khách tra theo gì, ai được xem gì? → Đáp: theo container number, booking number, B/L number (1 booking/B/L có nhiều container). Không đăng nhập chỉ thấy mốc chính; khách đăng nhập thấy chi tiết (seal, trọng lượng, chứng từ).`,
    `Hỏi: Độ tươi và độ trễ tra cứu? → Đáp: sự kiện hiện trên portal trong ≤ 2 phút (p95) kể từ lúc hệ thống nhận; tra cứu p95 < 300 ms; tracking API 99,9%.`,
    `Hỏi: Có sự kiện trùng, lệch thứ tự không? → Đáp: Có — EDI gửi lại cả file, cùng một sự kiện đến từ terminal API và từ EDI với timestamp lệch vài phút, sự kiện đến trễ hàng giờ, đối tác gửi bản sửa/huỷ cho sự kiện cũ.`,
    `Hỏi: Thông báo có trong phạm vi? → Đáp: Chỉ đến mức phát sự kiện "đạt mốc mới" cho notification service; cách gửi email/webhook là bài khác.`,
    `Hỏi: Lưu bao lâu, gì ngoài phạm vi? → Đáp: 2 năm truy cập online rồi archive; giữ payload gốc để đối soát. Ngoài phạm vi: dự đoán ETA bằng ML, vị trí AIS realtime của tàu, billing.`
  ],
  phases: {
    req: {
      checks: [
        `Functional: ingest đa nguồn (EDI theo lô + API), chuẩn hoá về một bộ mã sự kiện chung, tra cứu theo container/booking/B/L, phát sự kiện mốc cho thông báo.`,
        `Coi dữ liệu bẩn là yêu cầu chính: trùng, lệch thứ tự, đến trễ, correction/cancel từ đối tác.`,
        `Non-functional: sự kiện lên portal ≤ 2 phút p95, tra cứu p95 < 300 ms, API 99,9%, ingest chịu burst khi EDI dồn file.`,
        `Phân quyền: public chỉ thấy mốc chính, khách đăng nhập thấy chi tiết; chống dò quét số container.`,
        `Ngoài phạm vi rõ ràng: ETA bằng ML, AIS realtime, billing.`
      ],
      hint: `Đừng lao vào vẽ hộp. Hỏi trước **nguồn sự kiện** vì nó quyết định gần hết độ khó: EDI theo lô nghĩa là burst và gửi lại cả file; nhiều nguồn cho cùng một container nghĩa là trùng và mâu thuẫn. Chốt 3 khoá tra cứu (container, booking, B/L) và quan hệ 1-nhiều giữa chúng. Một câu ghi điểm: "The hard part here is data quality, not throughput."`
    },
    est: {
      checks: [
        `2M container × 15 sự kiện / 30 ngày ≈ 1M sự kiện/ngày ≈ 12 sự kiện/s trung bình (giả định).`,
        `Burst: một file EDI 10–20k sự kiện → đỉnh vài trăm đến ~1 000 sự kiện/s trong vài chục giây; raw message ~×2 vì trùng nguồn.`,
        `Đọc: 300k tra cứu portal + 3M lần poll API/ngày ≈ 40 QPS trung bình, đỉnh ~400 QPS.`,
        `Lưu trữ: ~1 KB/sự kiện chuẩn hoá → ~365 GB/năm; payload gốc ~2 KB → ~730 GB/năm trên object storage.`,
        `Kết luận nói to: quy mô vừa phải, độ khó nằm ở tính đúng và burst.`
      ],
      hint: `Tính theo phễu: container đang chạy → sự kiện/hành trình → sự kiện/ngày → /86 400. Sau đó nhân hệ số burst vì EDI đến theo lô. Phía đọc, tách người dùng portal với đối tác poll API — đối tác poll thường chiếm phần lớn và là lý do nên có webhook. Con số nhỏ (12 sự kiện/s) là **thông tin quan trọng**: nó cho phép bạn nói Postgres đủ dùng.`
    },
    hld: {
      checks: [
        `Sơ đồ: adapter ingest (SFTP/AS2, webhook) → lưu payload gốc lên GCS → Pub/Sub → normalizer → event store (+ outbox) → topic sự kiện chuẩn hoá → projection read model + notification; Tracking API + Redis; Next.js portal.`,
        `Tách đường ghi bất đồng bộ (chịu burst, replay được) khỏi đường đọc (read model tóm tắt tính sẵn).`,
        `API: GET container summary, GET events của container, GET theo booking và B/L, POST subscription, POST ingest cho đối tác có xác thực và idempotent.`,
        `Mô hình dữ liệu: tracking_events với dedup_key UNIQUE và index (container_no, journey_id, event_time); container_summary; bảng tham chiếu booking/B/L → container.`,
        `Nhắc ghi sự kiện và outbox cùng transaction để không mất thông báo khi publish lỗi.`
      ],
      hint: `Vẽ từ trái sang phải: nguồn → ingest → hàng đợi → normalizer → store → read model → API → portal. Hai quyết định cần nói rõ: (1) **lưu raw trước khi parse** để sửa mapping rồi chạy lại được; (2) API đọc **read model** chứ không tính lại từ chuỗi sự kiện mỗi request. Liệt kê API dạng bảng và nói khoá chính của từng bảng.`
    },
    deep: {
      checks: [
        `Dedup nhiều lớp: checksum file + interchange control number; dedup_key từ khoá nghiệp vụ (container, hành trình, mã sự kiện, địa điểm, chuyến); ON CONFLICT ở DB là lưới cuối; Redis chỉ là bộ lọc nhanh.`,
        `Lệch thứ tự: lưu theo event_time, trạng thái hiện tại tính lại từ toàn bộ chuỗi theo quy tắc mốc, không phải "sự kiện nhận sau cùng".`,
        `Correction/cancel: đánh dấu SUPERSEDED/CANCELLED, tính lại summary, phát sự kiện "milestone corrected".`,
        `Chọn store có lập luận: Postgres partition theo tháng đủ ở ~12 sự kiện/s; Cassandra khi cần multi-region active-active hoặc hàng chục nghìn sự kiện/s; vẽ được schema Cassandra.`,
        `Cache: summary trong Redis TTL ngắn + xoá khi có sự kiện mới; trang public cache CDN 30–60 s; rate limit + kiểm tra check digit ISO 6346 cho tra cứu public.`,
        `Ordering key theo container_no trên Pub/Sub hoặc version trên summary để 2 worker không ghi đè nhau.`
      ],
      hint: `Ba điểm chắc chắn bị hỏi: **trùng**, **lệch thứ tự**, **chọn DB**. Với trùng: phân biệt trùng do gửi lại (cùng message id) và trùng do khác nguồn (khác id, timestamp lệch) — cái sau cần khoá nghiệp vụ không chứa timestamp cho các mốc chỉ xảy ra 1 lần/hành trình. Với lệch thứ tự: "status is derived, not overwritten". Với DB: so sánh bằng bảng rồi chọn theo số liệu đã ước lượng.`
    },
    wrap: {
      checks: [
        `Tóm tắt: ingest bất đồng bộ + lưu raw, dedup bằng khoá tất định, trạng thái tính lại từ chuỗi, read model cho tra cứu.`,
        `Trade-off: chấp nhận trễ 1–2 phút để chịu burst và replay được; Postgres trước, Cassandra khi có số liệu.`,
        `Rủi ro: mapping mã sự kiện sai theo đối tác; đối tác ngừng gửi mà không ai biết → cảnh báo "không nhận dữ liệu từ nguồn X trong 2 giờ".`,
        `Bước tiếp: metric theo nguồn (độ trễ, tỉ lệ trùng, tỉ lệ lỗi parse), công cụ replay, webhook thay cho polling.`
      ],
      hint: `Kết bằng một câu về **observability theo nguồn dữ liệu**: hệ thống tracking chết kiểu im lặng (một terminal ngừng gửi EDI) nguy hiểm hơn chết kiểu ồn ào. Đây cũng là chỗ kể bài học thật: publisher RabbitMQ chết im lặng nhiều ngày trong hệ SBOM vì không có cảnh báo "không có dữ liệu".`
    }
  },
  followups: [
    `The same "loaded" event arrives from the terminal API and, two hours later, from an EDI file with a timestamp three minutes different. How do you dedupe it?`,
    `An "arrived" event shows up after "discharged". What does the customer see?`,
    `A partner sends a correction cancelling an event from yesterday. Walk me through what changes and who gets notified.`,
    `Why not store everything in MongoDB, one document per container?`,
    `What would the Cassandra schema look like, and when would you actually choose Cassandra here?`,
    `How do you find out that a terminal has silently stopped sending us EDI?`,
    `A large forwarder polls the tracking API for 50,000 containers every five minutes. What do you do?`,
    `How do you stop someone from scraping the public page by enumerating container numbers?`,
    `We fixed the event-code mapping for one partner. How do you reprocess last month's data safely?`
  ],
  rubric_notes: `### Câu trả lời mạnh có gì
- Nhận ra sớm: quy mô vừa phải (~12 sự kiện/s), độ khó nằm ở **chất lượng dữ liệu** — trùng, lệch thứ tự, correction.
- Lưu **payload gốc** trước khi parse, nhờ đó sửa mapping rồi replay được.
- Dedup có **nhiều lớp** và phân biệt trùng do gửi lại với trùng do khác nguồn.
- Trạng thái container là **dẫn xuất** từ chuỗi sự kiện theo event_time, không ghi đè theo thứ tự nhận.
- Chọn DB bằng số liệu: Postgres đủ ở quy mô giả định; trình bày được schema Cassandra và điều kiện để chuyển sang.
### Bẫy thường gặp
- Dùng hash có timestamp làm khoá dedup → sự kiện từ hai nguồn lệch 3 phút thành hai bản ghi.
- Chọn Cassandra "vì JD có Cassandra" mà không nêu được partition key và giới hạn kích thước partition.
- Publish sự kiện trực tiếp sau khi ghi DB, không outbox → mất thông báo khi publish lỗi.
- Quên phân quyền public/đăng nhập và chống dò quét số container.
### Dấu hiệu senior
- Đề xuất cảnh báo "nguồn im lặng" và metric theo đối tác; nghĩ đến công cụ replay và SLA với đối tác.`,
  reference: `### Yêu cầu chốt
- Functional: ingest EDI theo lô và API realtime; chuẩn hoá về bộ mã nội bộ (GATE_IN, LOADED, DEPARTED, ARRIVED, DISCHARGED, GATE_OUT...); tra theo container/booking/B/L; đăng ký nhận cập nhật; phát sự kiện mốc cho notification.
- Non-functional: sự kiện lên portal ≤ 2 phút p95, tra cứu p95 < 300 ms, API 99,9%, chịu burst EDI, lưu 2 năm online + payload gốc.
- Ngoài phạm vi: ETA bằng ML, AIS realtime, billing.
### Ước lượng (giả định)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Sự kiện chuẩn hoá | 2M container × 15 / 30 ngày | ~1M/ngày ≈ 12/s |
| Burst EDI | file 10–20k sự kiện trong vài chục giây | đỉnh ~1 000/s |
| Raw message | ×2 do trùng nguồn | ~2M/ngày |
| Đọc | 300k portal + 3M poll API mỗi ngày | ~40 QPS, đỉnh ~400 QPS |
| Lưu sự kiện | 1M × 1 KB × 365 | ~365 GB/năm |
| Payload gốc (GCS) | 2M × ~1 KB × 365 | ~730 GB/năm |
| Redis summary | 500k container nóng × 2 KB | ~1 GB |
### Thiết kế tổng thể
:::diagram
EDI[EDI SFTP/AS2] -> Ingest[Ingest adapters]
TAPI[Terminal API/webhook] -> Ingest
Ingest -> Raw[GCS payload gốc] : lưu nguyên bản
Ingest -> RawTopic[Pub/Sub raw-events]
RawTopic -> Norm[Normalizer NestJS] : map mã, dedup
Norm -> Store[Postgres events + outbox] : upsert
Store -> EvTopic[Pub/Sub tracking-events] : outbox relay
EvTopic -> Proj[Projection worker]
Proj -> Summary[container_summary]
EvTopic -> Notif[Notification service]
Portal[Next.js portal] -> API[Tracking API NestJS]
API -> Cache[Redis]
API -> Summary
API -> Store : chi tiết sự kiện
:::
- Ghi: adapter nhận file/webhook → lưu GCS → publish con trỏ tới payload → normalizer parse, map mã đối tác → mã nội bộ, tính dedup_key → INSERT ... ON CONFLICT DO NOTHING + outbox trong 1 transaction → chỉ sự kiện **mới hoặc đổi** được publish.
- Đọc: API đọc summary từ Redis (miss thì từ container_summary), chi tiết sự kiện đọc theo index (container_no, journey_id, event_time).
### API chính
| Method | Path | Mục đích |
|---|---|---|
| GET | /v1/containers/{containerNo} | Trạng thái hiện tại, vị trí, chuyến, ETA, các mốc |
| GET | /v1/containers/{containerNo}/events | Chuỗi sự kiện của hành trình (mặc định hành trình hiện tại) |
| GET | /v1/bookings/{bookingNo}/containers | Container và trạng thái theo booking |
| GET | /v1/bills-of-lading/{blNo} | B/L → danh sách container + summary |
| POST | /v1/subscriptions | Đăng ký theo container/B/L, loại mốc, kênh |
| POST | /v1/partner/events | Đối tác đẩy sự kiện (mTLS/API key, idempotent theo message id) |
### Mô hình dữ liệu
- tracking_events: id, container_no, journey_id, event_code, event_class (ACTUAL/ESTIMATED), location (UN/LOCODE), vessel_voyage, event_time (UTC + offset cảng), source, source_ref, dedup_key UNIQUE, status (ACTIVE/SUPERSEDED/CANCELLED), received_at; partition theo tháng.
- container_summary: container_no, journey_id, booking_no, bl_no, current_status, last_location, eta, milestones (jsonb), version.
- journey_refs: booking_no/bl_no → container_no, journey_id (đồng bộ từ hệ thống booking). raw_messages: đường dẫn GCS, checksum, interchange control number.
### Đào sâu 1: dedup
| Lớp | Cách làm | Bắt được |
|---|---|---|
| File | checksum + interchange control number | đối tác gửi lại cả file |
| Sự kiện | dedup_key = hash(container, journey, event_code, location, voyage) cho mốc 1 lần/hành trình; thêm bucket thời gian cho sự kiện lặp được | cùng sự kiện từ 2 nguồn, timestamp lệch |
| Ghi DB | ON CONFLICT (dedup_key): bỏ qua hoặc merge theo độ ưu tiên nguồn | redelivery Pub/Sub, 2 worker chạy đua |
- Chọn cả ba; Redis SET NX chỉ là tối ưu, unique constraint mới là bảo đảm. Nguồn chính xác hơn (terminal API) được ưu tiên khi hai nguồn mâu thuẫn về giờ.
### Đào sâu 2: lệch thứ tự và correction
| Phương án | Ưu | Nhược |
|---|---|---|
| Trạng thái = sự kiện nhận sau cùng | đơn giản | "arrived" đến trễ ghi đè "discharged" |
| Buffer 30 phút rồi sắp xếp | ít đảo trạng thái | trễ mọi sự kiện, vẫn sai với sự kiện trễ hàng giờ |
| Tính lại summary từ cả chuỗi theo event_time + quy tắc mốc | đúng, idempotent, replay được | 1 query/sự kiện (rẻ: ~20 sự kiện/hành trình) |
- Chọn phương án 3; ordering key container_no trên Pub/Sub và cột version trên summary chống ghi đè. Correction đánh dấu SUPERSEDED, tính lại, phát "milestone corrected"; mốc đến trễ vẫn báo nhưng gắn cờ late.
### Đào sâu 3: chọn store
| Tiêu chí | Postgres (partition tháng) | MongoDB | Cassandra |
|---|---|---|---|
| Ghi append | tốt tới vài nghìn/s/node | tốt | rất tốt, scale tuyến tính |
| Đọc theo container + thời gian | index composite | index (containerNo, eventTime) | 1 partition, đã sắp sẵn |
| Truy vấn ad-hoc, báo cáo | tốt nhất | khá | kém, mỗi query một bảng |
| Multi-region active-active | khó | primary 1 vùng | có sẵn |
| Vận hành | quen thuộc | vừa | nặng (repair, compaction) |
- Ở ~12 sự kiện/s chọn Postgres. Chuyển Cassandra khi cần ingest active-active nhiều region hoặc vượt hàng chục nghìn sự kiện/s; schema: PRIMARY KEY ((container_no, journey_id), event_time, dedup_key), clustering event_time DESC, bảng thứ hai events_by_booking.
- Cache: summary Redis TTL 60 s, projection xoá key khi có sự kiện mới; trang public CDN s-maxage 30 s; tra cứu public kiểm tra check digit ISO 6346 + rate limit theo IP; đối tác lớn chuyển sang webhook + bulk endpoint.
### Trade-off
- Trễ 1–2 phút do pipeline bất đồng bộ, đổi lại chịu burst, replay được và cô lập lỗi nguồn.
- Read model tách riêng: thêm một bản sao dữ liệu phải giữ đồng bộ, đổi lại tra cứu O(1).
### Nói thế nào trong phỏng vấn (EN)
- "At about twelve events per second, throughput is not the problem; duplicates, late events and corrections are." — Lưu lượng không khó, dữ liệu bẩn mới khó.
- "I store the raw payload before parsing, so a mapping bug becomes a replay, not data loss." — Lưu payload gốc để lỗi mapping chỉ cần chạy lại.
- "Container status is derived from the event history ordered by event time, never overwritten by whatever arrived last." — Trạng thái là dẫn xuất từ chuỗi sự kiện.
- "The dedup key is built from business fields, not timestamps, so the same milestone from two sources collapses into one row." — Khoá dedup từ trường nghiệp vụ.
- "I'd start on Postgres and move to Cassandra only for multi-region active-active ingest or much higher volume." — Postgres trước, Cassandra khi có lý do.`
});

/* ---------- JM2 ---------- */
window.MOCKS.push({
  id: 'JM2',
  title: 'Design a booking system for vessel capacity',
  level: 3,
  prompt: `Design the booking system that lets customers reserve container space on a vessel voyage. Each voyage has a fixed capacity in TEU, the business wants controlled overbooking, unconfirmed holds must expire, and a booking only becomes final after payment or credit approval. Assume NestJS services and Postgres.
Thiết kế hệ thống booking cho khách đặt chỗ container trên chuyến tàu. Mỗi chuyến có sức chứa TEU cố định, nghiệp vụ muốn overbooking có kiểm soát, giữ chỗ chưa xác nhận phải hết hạn, booking chỉ chốt sau khi thanh toán hoặc duyệt tín dụng. Giả định dùng NestJS và Postgres.`,
  clarify: [
    `Hỏi: Đơn vị sức chứa là gì? → Đáp: TEU (container 20ft = 1 TEU, 40ft/40HC = 2 TEU) cộng số ổ cắm reefer tính riêng; trọng lượng và stowage chi tiết ngoài phạm vi (giả định).`,
    `Hỏi: Overbooking bao nhiêu? → Đáp (giả định): hạn mức theo từng chuyến, mặc định 105% TEU vì ~5–10% booking bị huỷ hoặc không giao hàng; quá hạn mức thì vào waitlist; bộ phận revenue chỉnh được hạn mức.`,
    `Hỏi: Giữ chỗ bao lâu? → Đáp: hold 30 phút cho khách thanh toán online; khách có hạn mức tín dụng thì hold đến khi credit check xong (thường vài giây, tối đa 24 giờ nếu duyệt tay).`,
    `Hỏi: Quy mô? → Đáp (giả định): 3 000 chuyến đang mở bán, 20 000 booking/ngày; chuyến "nóng" (mùa cao điểm, tuyến hot) có thể nhận 200 yêu cầu trong 1 phút.`,
    `Hỏi: Sửa và huỷ? → Đáp: đổi số lượng, đổi chuyến, huỷ đều phải trả capacity; phí huỷ sau cut-off ngoài phạm vi.`,
    `Hỏi: Có transshipment không? → Đáp: Có, booking gồm 1–3 leg; mọi leg đều giữ được chỗ thì mới xác nhận (all-or-nothing).`,
    `Hỏi: Kênh đặt chỗ? → Đáp: portal web và API cho forwarder; HTTP client của đối tác tự retry nên mọi thao tác ghi phải idempotent.`,
    `Hỏi: Gì ngoài phạm vi? → Đáp: báo giá/pricing, stowage plan, nội dung EDI booking confirmation (chỉ cần phát event).`
  ],
  phases: {
    req: {
      checks: [
        `Functional: kiểm tra chỗ trống, tạo hold có hạn, xác nhận sau thanh toán/duyệt tín dụng, huỷ/sửa trả capacity, waitlist khi vượt hạn mức.`,
        `Bất biến số 1: held + confirmed ≤ cap × (1 + overbook_pct) tại mọi thời điểm, kể cả khi retry và lỗi giữa chừng.`,
        `Mọi thao tác ghi idempotent vì đối tác retry; transshipment all-or-nothing.`,
        `Non-functional: tạo booking p95 < 1 s (không tính thời gian thanh toán), consistency mạnh cho capacity, eventual cho thông báo/EDI.`,
        `Ngoài phạm vi: pricing, stowage, nội dung EDI.`
      ],
      hint: `Viết bất biến lên bảng ngay phút đầu: "held + confirmed never exceeds the overbooking limit". Hỏi rõ overbooking là **chính sách kinh doanh có chủ đích**, không phải lỗi. Tách khái niệm hold (tạm, có hạn) với confirmed (chốt) vì toàn bộ thiết kế xoay quanh vòng đời đó.`
    },
    est: {
      checks: [
        `20k booking/ngày ≈ 0,25/s trung bình, đỉnh giờ làm việc ×10 ≈ 2–3/s toàn hệ thống (giả định).`,
        `Chuyến nóng: 200 yêu cầu/phút ≈ 3–4/s dồn vào **một dòng** capacity.`,
        `Đọc availability/lịch ≈ 50–100 lần ghi → vài chục đến vài trăm QPS, cache được.`,
        `Lưu trữ: ~5 KB/booking × 20k × 365 ≈ 36 GB/năm — nhỏ.`,
        `Kết luận: bài toán đồng thời và tính đúng; lock giữ 5 ms → một dòng chịu ~200 tx/s, nhưng gọi payment 2 s trong lock → 0,5 tx/s, sập.`
      ],
      hint: `Con số quan trọng nhất không phải QPS toàn hệ thống mà là **tx/s trên một dòng nóng** và **thời gian giữ lock**. Tính: 1 000 ms / thời gian giữ lock = trần throughput của dòng đó. Từ đó rút ra luật: không bao giờ gọi dịch vụ ngoài trong transaction giữ lock capacity.`
    },
    hld: {
      checks: [
        `Booking service (NestJS) + Postgres là nguồn sự thật cho capacity và booking; payment/credit là service riêng nối qua saga.`,
        `State machine: REQUESTED → HELD → CONFIRMED; HELD → EXPIRED/REJECTED/CANCELLED; WAITLISTED → HELD khi có chỗ.`,
        `API: GET availability, POST /bookings (Idempotency-Key), GET booking, POST cancellation, PATCH sửa số lượng.`,
        `Dữ liệu: voyage_capacity (cap_teu, overbook_pct, held_teu, confirmed_teu, version), bookings, booking_legs, holds (expires_at), idempotency_keys, outbox.`,
        `Outbox + Pub/Sub cho saga và cho notification/EDI; job hết hạn hold.`
      ],
      hint: `Vẽ state machine trước sơ đồ hạ tầng — người phỏng vấn đề này muốn thấy bạn nghĩ theo **vòng đời booking**. Sau đó mới vẽ: client → BFF → booking service → Postgres → outbox → Pub/Sub → payment service. Nêu rõ capacity và booking nằm **cùng một DB** để cập nhật trong một transaction.`
    },
    deep: {
      checks: [
        `So sánh conditional UPDATE, SELECT ... FOR UPDATE và optimistic version trên dòng nóng; chọn conditional UPDATE và giải thích vì sao.`,
        `Idempotent booking: Idempotency-Key + UNIQUE, ghi cùng transaction với hold; retry trả kết quả cũ.`,
        `Hold hết hạn: expires_at + job quét bằng partial index và SKIP LOCKED, trả capacity trong cùng transaction; xử lý race "thanh toán thành công đúng lúc hold hết hạn".`,
        `Saga với payment: orchestration trong booking service, bước bù (release hold, refund), timeout, mỗi bước idempotent.`,
        `Overbooking: tách held và confirmed, hạn mức theo chuyến, waitlist; quy trình khi thực tế vượt sức chứa (roll sang chuyến sau, ưu tiên theo hợp đồng).`,
        `Multi-leg: giữ chỗ các leg theo thứ tự cố định (voyage_id tăng dần) trong một transaction để tránh deadlock.`
      ],
      hint: `Câu hỏi chắc chắn có: "two customers book the last 4 TEU at the same time". Trả lời bằng **đúng câu SQL** bạn sẽ chạy và chỉ ra vì sao nó atomic. Sau đó tự nêu race thứ hai (payment callback vs expiry job) trước khi bị hỏi. Với saga, nói rõ bước bù của từng bước và chuyện gì xảy ra nếu chính bước bù thất bại.`
    },
    wrap: {
      checks: [
        `Nhắc lại bất biến và ba lớp bảo vệ: conditional UPDATE, unique idempotency key, trạng thái hold có điều kiện khi confirm.`,
        `Trade-off: hold làm undersell tạm thời; orchestration tập trung logic nhưng booking service thành điểm phối hợp.`,
        `Kiểm thử: test đồng thời với Postgres thật (Testcontainers, 200 request song song), kiểm tra bất biến sau mỗi lần chạy.`,
        `Metric: tỉ lệ hold hết hạn, thời gian giữ lock, số booking bị từ chối vì hết chỗ, độ tuổi saga treo.`
      ],
      hint: `Kết bằng cách bạn **chứng minh** thiết kế đúng: test đồng thời bắn 200 request vào chuyến còn 10 TEU rồi assert tổng không vượt hạn mức. Người phỏng vấn level 3 đánh giá cao việc biến bất biến thành test tự động.`
    }
  },
  followups: [
    `Two customers try to book the last 4 TEU at the same moment. Walk me through exactly what happens in the database.`,
    `Why not use SELECT ... FOR UPDATE everywhere? When would optimistic locking be the better choice?`,
    `Payment succeeds one second after the hold expired and the space was given to someone else. What do you do?`,
    `The payment service is down for 20 minutes. What happens to new bookings and to existing holds?`,
    `A partner's HTTP client retries POST /bookings three times. How do you make that safe?`,
    `Leg 2 of a transshipment booking has no space. What does the customer get and what happens to leg 1?`,
    `Overbooking means we may confirm more than the vessel can carry. What happens on sailing day?`,
    `How would you test the concurrency logic so that you actually trust it?`,
    `How would the design change if capacity were owned by a separate inventory service run by another team?`,
    `Which metrics and alerts would you put on this system?`
  ],
  rubric_notes: `### Câu trả lời mạnh có gì
- Bất biến capacity được phát biểu sớm và bảo vệ bằng **một câu SQL atomic**, không phải đọc-rồi-ghi trong code.
- Tách rõ hold và confirmed, có job hết hạn và giải quyết race giữa callback thanh toán với expiry.
- Không bao giờ gọi payment trong transaction giữ lock; giải thích bằng phép tính throughput của dòng nóng.
- Saga có bước bù cụ thể, timeout, idempotent; biết "exactly-once" không tồn tại giữa các service.
- Overbooking được xử lý như chính sách có tham số và có quy trình ngày tàu chạy.
### Bẫy thường gặp
- SELECT còn bao nhiêu chỗ rồi UPDATE ở hai câu riêng trong READ COMMITTED → overbook ngoài ý muốn.
- Distributed lock trên Redis cho việc mà một câu UPDATE có điều kiện đã giải quyết được.
- Quên idempotency → đối tác retry tạo 3 booking.
- Gom capacity và booking vào hai DB khác nhau ngay từ đầu rồi phải dùng 2PC.
### Dấu hiệu senior
- Đề xuất test đồng thời trên Postgres thật và metric "saga treo quá 30 phút"; nói được khi nào chuyển sang SERIALIZABLE hoặc tách inventory service.`,
  reference: `### Yêu cầu chốt
- Functional: xem chỗ trống; tạo booking → hold có hạn; xác nhận sau thanh toán/duyệt tín dụng; huỷ/sửa trả capacity; waitlist khi vượt hạn mức; transshipment all-or-nothing; mọi thao tác ghi idempotent.
- Non-functional: bất biến held + confirmed ≤ floor(cap × (1 + overbook_pct)) luôn đúng; tạo booking p95 < 1 s; consistency mạnh cho capacity, eventual cho thông báo/EDI; 99,9%.
### Ước lượng (giả định)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Ghi booking | 20k / 86 400 | ~0,25/s, đỉnh ~3/s |
| Dòng nóng | 200 yêu cầu / 60 s | ~3–4 tx/s trên 1 dòng |
| Trần dòng nóng | 1 000 ms / 5 ms giữ lock | ~200 tx/s — đủ |
| Nếu gọi payment trong lock | 1 000 ms / 2 000 ms | 0,5 tx/s — sập |
| Đọc availability | ~50–100 × ghi | vài chục đến vài trăm QPS |
| Lưu trữ | 5 KB × 20k × 365 | ~36 GB/năm |
### Thiết kế tổng thể
:::diagram
Client[Portal / API đối tác] -> BFF[BFF / API gateway]
BFF -> Booking[Booking service NestJS] : Idempotency-Key
Booking -> PG[Postgres capacity + bookings + outbox]
PG -> Relay[Outbox relay]
Relay -> Topic[Pub/Sub booking-events]
Topic -> Payment[Payment / credit service]
Payment -> PSP[Payment provider]
Payment -> PayTopic[Pub/Sub payment-events]
PayTopic -> Booking : bước saga tiếp theo
Expiry[Hold expiry job] -> PG : hết hạn, trả chỗ
Topic -> Notif[Notification]
Topic -> EDI[EDI / vessel ops]
:::
- Vòng đời: REQUESTED → HELD (trừ capacity) → CONFIRMED (chuyển held sang confirmed); HELD → EXPIRED/REJECTED/CANCELLED (trả capacity); WAITLISTED → HELD khi có chỗ.
- Luồng chính: POST /bookings → transaction: kiểm tra idempotency key, conditional UPDATE từng leg, INSERT booking + hold + outbox "booking.held" → trả 201 trạng thái HELD → payment service xử lý → "payment.succeeded" → transaction confirm có điều kiện → outbox "booking.confirmed".
### API chính
| Method | Path | Mục đích |
|---|---|---|
| GET | /v1/voyages/{voyageId}/availability | TEU và reefer còn lại (cache 30 s) |
| POST | /v1/bookings | Tạo booking + hold, header Idempotency-Key |
| GET | /v1/bookings/{id} | Trạng thái, legs, hạn hold |
| PATCH | /v1/bookings/{id} | Đổi số lượng/chuyến (giữ chỗ mới trước, trả chỗ cũ sau) |
| POST | /v1/bookings/{id}/cancellation | Huỷ, trả capacity |
### Mô hình dữ liệu
- voyage_capacity(voyage_id PK, cap_teu, overbook_pct, held_teu, confirmed_teu, reefer_cap, reefer_used, version).
- bookings(id, customer_id, status, total_teu, created_at), booking_legs(booking_id, leg_no, voyage_id, teu), holds(booking_id, expires_at, status) với partial index (expires_at) WHERE status = 'HELD'.
- idempotency_keys(customer_id, key, request_hash, response, created_at) UNIQUE(customer_id, key); outbox(id, aggregate_id, type, payload, published_at).
### Đào sâu 1: tranh chấp đồng thời
~~~sql
UPDATE voyage_capacity
SET held_teu = held_teu + $2, version = version + 1
WHERE voyage_id = $1
  AND held_teu + confirmed_teu + $2 <= floor(cap_teu * (1 + overbook_pct))
RETURNING held_teu, confirmed_teu;
~~~
| Phương án | Ưu | Nhược | Hợp khi |
|---|---|---|---|
| Conditional UPDATE (trên) | 1 câu atomic, lock ngắn nhất, không retry | logic kiểm tra nằm trong SQL | kiểm tra trên 1 dòng — chọn |
| SELECT ... FOR UPDATE rồi kiểm tra trong code | linh hoạt, quy tắc phức tạp | lock lâu hơn, dễ lỡ tay gọi I/O trong lock | quy tắc nhiều bước trên vài dòng |
| Optimistic (cột version) | không giữ lock | dòng nóng → nhiều xung đột, retry dồn | tranh chấp thấp, ví dụ sửa hồ sơ |
- 0 dòng trả về → hết chỗ → WAITLISTED hoặc 409. Multi-leg: UPDATE các leg theo voyage_id tăng dần trong cùng transaction để tránh deadlock; một leg thất bại → rollback cả transaction.
### Đào sâu 2: hold hết hạn và race với thanh toán
- Expiry job mỗi 30 s: chọn hold HELD có expires_at < now() − 2 phút ân hạn, FOR UPDATE SKIP LOCKED LIMIT 500, đổi EXPIRED và trừ held_teu trong cùng transaction; nhiều instance chạy song song không giẫm nhau.
- Confirm là UPDATE có điều kiện status = 'HELD'. Nếu 0 dòng (đã hết hạn): thử giữ chỗ lại; còn chỗ → confirm; hết chỗ → refund (bước bù) + thông báo + đưa waitlist ưu tiên.
| Cách hết hạn | Ưu | Nhược |
|---|---|---|
| Job quét + partial index | đơn giản, chạy lại được | trễ tối đa 1 chu kỳ |
| Cloud Tasks hẹn giờ cho từng hold | đúng giờ | thêm hạ tầng, vẫn cần job đối soát |
| TTL Redis + keyspace event | nhanh | event có thể mất, không bền |
### Đào sâu 3: saga với payment
| Kiểu | Ưu | Nhược |
|---|---|---|
| Orchestration (booking service điều phối) | luồng nhìn thấy ở một chỗ, dễ timeout và bù | booking service ôm logic phối hợp |
| Choreography (mỗi service phản ứng event) | lỏng, dễ thêm bên nghe | khó lần theo, khó biết saga treo |
- Chọn orchestration: bảng saga_state(booking_id, step, deadline). Bước bù: release hold, refund, huỷ credit reservation; consumer dedup theo event id; saga quá deadline → cảnh báo + tự bù.
### Trade-off
- Hold gây undersell tạm thời (chỗ bị giữ rồi hết hạn) để đổi lấy không bao giờ vượt hạn mức.
- Capacity và booking chung một Postgres: transaction đơn giản, đổi lại khó tách service sau này; tách thì chuyển sang reservation API có idempotency + saga.
- Overbooking 105% có thể vượt sức chứa thật vào ngày tàu chạy → quy trình roll cargo sang chuyến sau theo ưu tiên hợp đồng, là việc của nghiệp vụ, hệ thống chỉ cần báo sớm.
### Nói thế nào trong phỏng vấn (EN)
- "The invariant is held plus confirmed never exceeds the overbooking limit, and a single conditional update enforces it atomically." — Một câu UPDATE có điều kiện bảo vệ bất biến.
- "I never call the payment provider while holding the capacity lock; at two seconds per call the hot row would drop to half a transaction per second." — Không gọi payment trong lock.
- "Confirmation is conditional on the hold still being active, so a late payment either re-acquires space or triggers a refund." — Confirm có điều kiện, thanh toán muộn thì giữ lại chỗ hoặc hoàn tiền.
- "Every write takes an idempotency key stored in the same transaction, because partners will retry." — Mọi thao tác ghi đều idempotent.
- "I'd prove it with a concurrency test against real Postgres: two hundred parallel requests, then assert the invariant." — Chứng minh bằng test đồng thời trên Postgres thật.`
});

/* ---------- JM3 ---------- */
window.MOCKS.push({
  id: 'JM3',
  title: 'Design an ETA change notification system',
  level: 2,
  prompt: `Design a system that notifies customers when a vessel schedule changes: when the ETA of a voyage moves, we must work out which customers are affected and tell them by email, webhook or in-app message according to their preferences, without spamming them and without losing notifications. We run on GCP.
Thiết kế hệ thống báo cho khách khi lịch tàu thay đổi: ETA của chuyến đổi thì phải tính ra khách nào bị ảnh hưởng và báo qua email, webhook hoặc in-app theo preference của họ, không spam và không mất thông báo. Hạ tầng chạy trên GCP.`,
  clarify: [
    `Hỏi: Thay đổi lịch đến từ đâu? → Đáp: hệ thống vessel schedule phát sự kiện "voyage.schedule_changed" (port call, ETA/ETD cũ và mới, version tăng dần); vài nghìn thay đổi/ngày, phần lớn chỉ lệch vài phút.`,
    `Hỏi: Lệch bao nhiêu mới báo? → Đáp (giả định): mặc định khi ETA lệch ≥ 6 giờ so với lần đã báo gần nhất; khách chỉnh được 2–24 giờ.`,
    `Hỏi: Ai bị ảnh hưởng? → Đáp: khách có booking/container trên chuyến tại port call bị đổi (cảng xếp, cảng dỡ, cảng chuyển tải), cộng người subscribe container/B/L; một chuyến lớn có thể ~2 000 booking của ~500 khách (giả định).`,
    `Hỏi: Kênh và preference? → Đáp: email, webhook (forwarder tích hợp hệ thống của họ), in-app; mỗi khách chọn kênh, loại sự kiện, ngôn ngữ, giờ yên lặng theo múi giờ, có thể chọn bản tin gom (digest).`,
    `Hỏi: Độ trễ chấp nhận? → Đáp: webhook và in-app ≤ 5 phút, email ≤ 15 phút sau khi thay đổi được chốt.`,
    `Hỏi: Giới hạn bên ngoài? → Đáp (giả định): nhà cung cấp email cho phép ~100 email/s; webhook của từng khách có rate limit riêng và có thể chết vài giờ.`,
    `Hỏi: Audit cần gì, gì ngoài phạm vi? → Đáp: chứng minh đã báo cho ai, lúc nào, nội dung gì (tranh chấp phí lưu bãi), giữ 2 năm. Ngoài phạm vi: SMS, dự đoán ETA, nội dung marketing.`
  ],
  phases: {
    req: {
      checks: [
        `Functional: nhận sự kiện đổi lịch, tính tập khách bị ảnh hưởng, áp preference (kênh, ngưỡng, giờ yên lặng, ngôn ngữ), gửi email/webhook/in-app, inbox in-app, audit.`,
        `Chống spam là yêu cầu: ngưỡng lệch so với lần đã báo, gom thay đổi dồn dập, không báo khi ETA quay về như cũ.`,
        `Không mất thông báo: at-least-once end-to-end, có retry, DLQ, audit từng lần gửi.`,
        `Non-functional: webhook/in-app ≤ 5 phút, email ≤ 15 phút; chịu burst khi hàng trăm chuyến đổi cùng lúc; một kênh hoặc một khách lỗi không làm nghẽn người khác.`,
        `Ngoài phạm vi: SMS, dự đoán ETA, marketing.`
      ],
      hint: `Hỏi **ngưỡng báo** trước: nó quyết định số thông báo nhiều hơn mọi thứ khác. Hỏi giới hạn của nhà cung cấp email và tình trạng webhook của khách — đó là nguồn của mọi bài toán rate limit, retry, cô lập lỗi. Đừng quên audit: trong vận tải, "chúng tôi đã báo bạn lúc 09:12" là bằng chứng có giá trị tiền.`
    },
    est: {
      checks: [
        `5 000 thay đổi/ngày, ~10% vượt ngưỡng → ~500 thay đổi đáng báo/ngày (giả định).`,
        `Mỗi thay đổi ảnh hưởng ~300 booking → 150k impact/ngày; gom theo (khách, port call) → ~50k thông báo; × 1,5 kênh ≈ 75k lần gửi/ngày ≈ ~1/s trung bình.`,
        `Burst bão/đóng cảng: 200 chuyến đổi cùng lúc × 300 booking = 60k impact trong vài phút → ~500 lần gửi/s, vượt giới hạn email 100/s → phải xếp hàng và gom.`,
        `Audit: 75k × 2 KB ≈ 150 MB/ngày ≈ 55 GB/năm.`,
        `Kết luận: trung bình rất nhỏ; thiết kế cho fan-out burst và giới hạn từng kênh.`
      ],
      hint: `Vẽ phễu: thay đổi lịch → lọc ngưỡng → nhân số booking bị ảnh hưởng → gom theo khách → nhân số kênh. Sau đó tính kịch bản xấu nhất (bão) và so với giới hạn nhà cung cấp email. Kết luận đúng là "average is tiny, bursts and per-channel limits drive the design".`
    },
    hld: {
      checks: [
        `Sơ đồ: schedule service (outbox) → Pub/Sub schedule-changed → impact calculator (đọc booking read model + preference) → bảng notification intent (dedup) + outbox → topic/subscription theo kênh → worker email/webhook/in-app có rate limiter → nhà cung cấp; DLQ.`,
        `Tách intent (cần báo gì cho ai) khỏi delivery (từng lần gửi qua từng kênh).`,
        `API: preference GET/PUT, đăng ký webhook (secret ký HMAC), inbox in-app có cursor, đánh dấu đã đọc, tra soát audit nội bộ.`,
        `Dữ liệu: notification_intents (dedup_key UNIQUE, send_after), deliveries (trạng thái, attempts, provider_msg_id), preferences, last_notified_eta.`,
        `Mỗi kênh một subscription/worker pool riêng để cô lập lỗi.`
      ],
      hint: `Hai bảng là xương sống: **intent** (một khách cần biết port call X đổi ETA thành Y) và **delivery** (đã gửi intent đó qua email lúc nào, kết quả ra sao). Tách như vậy giúp gom, retry từng kênh và audit. Nêu rõ outbox ở cả hai chỗ publish.`
    },
    deep: {
      checks: [
        `Gom và chống nhiễu: debounce theo (khách, port call) với send_after = now + 10 phút, upsert giữ payload mới nhất; so với last_notified_eta, ETA quay về như cũ thì huỷ intent.`,
        `Bỏ qua sự kiện cũ bằng version của schedule thay vì tin thứ tự giao của Pub/Sub.`,
        `Rate limit theo kênh và theo endpoint khách: token bucket trong Redis, flow control của subscriber, circuit breaker cho webhook chết, tự tắt webhook sau 24 giờ lỗi và báo admin khách.`,
        `Không mất: outbox, at-least-once, retry backoff có jitter, DLQ sau N lần, công cụ redrive; không trùng: dedup_key cho intent, header event id cho người nhận webhook tự dedup.`,
        `Giờ yên lặng và múi giờ: tính theo tz của khách, dời send_after; ngôn ngữ template theo preference.`,
        `Cân nhắc Cloud Tasks cho delivery webhook (rate limit và lịch hẹn theo queue) so với Pub/Sub cho fan-out.`
      ],
      hint: `Điểm hay bị xoáy: "ETA flips five times in an hour" → debounce + so với lần đã báo. "Webhook down six hours" → cô lập theo endpoint, circuit breaker, không để nghẽn hàng đợi chung. "Never lose, never duplicate?" → nói thẳng: không mất thì làm được bằng outbox + at-least-once + audit; không trùng tuyệt đối ra thế giới bên ngoài là không thể, nên cung cấp event id để bên nhận dedup.`
    },
    wrap: {
      checks: [
        `Tóm tắt: intent tách khỏi delivery, debounce + ngưỡng, kênh cô lập với rate limit, outbox + DLQ + audit.`,
        `Trade-off: trễ thêm ~10 phút do debounce để đổi lấy ít nhiễu; at-least-once nên có thể trùng hiếm, bù bằng event id.`,
        `Vận hành: metric độ trễ thay đổi → gửi, backlog từng subscription, tỉ lệ DLQ, tỉ lệ lỗi từng webhook.`,
        `Mở rộng: thêm SMS chỉ cần một worker và một subscription mới.`
      ],
      hint: `Chốt bằng một câu về trải nghiệm khách: "Customers judge this system by noise and trust — one accurate, timely message beats five flapping ones." Nhắc metric end-to-end từ lúc lịch đổi đến lúc khách nhận.`
    }
  },
  followups: [
    `The ETA flips between Tuesday and Wednesday five times in an hour. What does the customer receive?`,
    `A customer's webhook endpoint has been down for six hours. What happens to their notifications, and to everyone else's?`,
    `A typhoon changes 200 voyages at once. Walk me through the load on each component.`,
    `Can you guarantee we never lose a notification? Can you guarantee we never send a duplicate?`,
    `How do you handle quiet hours and time zones for customers in different countries?`,
    `The email provider starts returning 429. What does the system do?`,
    `How would we prove to a customer that we notified them about a delay?`,
    `Why Pub/Sub instead of Cloud Tasks for deliveries, or would you use both?`,
    `How do you test this end to end without emailing real customers?`,
    `How would you add SMS later?`
  ],
  rubric_notes: `### Câu trả lời mạnh có gì
- Ước lượng chỉ ra trung bình rất nhỏ nhưng burst khi bão vượt giới hạn nhà cung cấp → thiết kế quanh fan-out và rate limit.
- Tách **intent** và **delivery**; dedup_key cho intent; audit từng lần gửi.
- Debounce + ngưỡng so với **lần đã báo** (không phải so với ETA trước đó), huỷ khi ETA quay về.
- Cô lập lỗi theo kênh và theo endpoint webhook; circuit breaker; DLQ có redrive.
- Trung thực về semantics: at-least-once, cung cấp event id để bên nhận dedup.
### Bẫy thường gặp
- Gửi ngay mỗi thay đổi → khách nhận 5 email trong 1 giờ.
- Một hàng đợi chung cho mọi kênh và mọi khách → một webhook chết làm nghẽn tất cả.
- Publish sự kiện trước khi commit (đúng sự cố audit log của hệ SBOM) → consumer đọc dữ liệu chưa tồn tại.
- Dựa vào thứ tự giao của Pub/Sub để quyết định ETA nào mới hơn.
### Dấu hiệu senior
- Đo độ trễ end-to-end, backlog từng subscription; nghĩ đến môi trường test có sink email giả và webhook giả.`,
  reference: `### Yêu cầu chốt
- Functional: nhận schedule_changed; tính khách bị ảnh hưởng (booking + subscription); áp preference (kênh, ngưỡng, giờ yên lặng, ngôn ngữ, digest); gửi email/webhook/in-app; inbox in-app; audit 2 năm.
- Non-functional: webhook/in-app ≤ 5 phút, email ≤ 15 phút; không mất thông báo; chịu burst; lỗi một kênh/khách không lan; at-least-once có dedup.
### Ước lượng (giả định)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Thay đổi đáng báo | 5 000/ngày × 10% | ~500/ngày |
| Impact | 500 × 300 booking | 150k/ngày |
| Thông báo logic | gom theo (khách, port call) | ~50k/ngày |
| Lần gửi | 50k × 1,5 kênh | ~75k/ngày ≈ 1/s |
| Burst bão | 200 chuyến × 300 booking | 60k impact trong vài phút, ~500 gửi/s |
| Giới hạn email | nhà cung cấp | ~100/s → xếp hàng ~10 phút |
| Audit | 75k × 2 KB × 365 | ~55 GB/năm |
### Thiết kế tổng thể
:::diagram
Sched[Vessel schedule service] -> T1[Pub/Sub schedule-changed] : outbox
T1 -> Impact[Impact calculator]
Impact -> BookRM[Booking read model]
Impact -> Pref[Preference store]
Impact -> NDB[Postgres intents + deliveries + outbox]
NDB -> T2[Pub/Sub delivery theo kênh]
T2 -> Email[Email worker]
T2 -> Hook[Webhook worker]
T2 -> InApp[In-app worker]
Email -> ESP[Email provider]
Hook -> Cust[Endpoint của khách]
InApp -> Portal[Portal inbox / WebSocket]
T2 -> DLQ[Dead-letter topic]
:::
- Luồng: impact calculator đọc booking theo (voyage, port call), loại khách có ngưỡng chưa vượt (so last_notified_eta), upsert intent với send_after; scheduler mỗi phút lấy intent đến hạn, tạo delivery cho từng kênh + outbox; worker từng kênh gửi theo rate limit, ghi kết quả vào deliveries.
### API chính
| Method | Path | Mục đích |
|---|---|---|
| GET | /v1/notification-preferences | Xem kênh, ngưỡng, giờ yên lặng, ngôn ngữ |
| PUT | /v1/notification-preferences | Cập nhật preference (validate tz, ngưỡng 2–24 h) |
| POST | /v1/webhooks | Đăng ký endpoint + secret ký HMAC, gửi ping xác minh |
| GET | /v1/notifications?cursor= | Inbox in-app, phân trang cursor |
| POST | /v1/notifications/{id}/read | Đánh dấu đã đọc |
| GET | /internal/notifications/audit?bookingNo= | Tra soát đã báo gì, cho ai, lúc nào |
### Mô hình dữ liệu
- notification_intents(id, customer_id, port_call_id, schedule_version, payload, send_after, status, dedup_key UNIQUE = customer + port_call + schedule_version).
- deliveries(id, intent_id, channel, target, status PENDING/SENT/FAILED/DEAD, attempts, provider_msg_id, last_error, sent_at) — chính là audit.
- preferences(customer_id, channels, event_types, threshold_hours, quiet_hours, tz, language, digest); last_notified_eta(customer_id, port_call_id, eta, notified_at).
### Đào sâu 1: gom và chống nhiễu
| Phương án | Ưu | Nhược |
|---|---|---|
| Gửi ngay mỗi thay đổi vượt ngưỡng | trễ thấp nhất | ETA dao động → nhiều tin mâu thuẫn |
| Debounce 10 phút theo (khách, port call) | gom dao động, gửi trạng thái cuối | trễ thêm tối đa 10 phút |
| Digest theo giờ/ngày | ít tin nhất | không hợp thay đổi gấp |
- Chọn debounce làm mặc định, digest là tuỳ chọn của khách. Upsert intent theo (khách, port call) thay payload bằng bản mới nhất; đến hạn mà ETA mới lệch < ngưỡng so với last_notified_eta → huỷ, không gửi. Sự kiện có schedule_version nhỏ hơn bản đã xử lý → bỏ qua.
### Đào sâu 2: rate limit và cô lập lỗi
| Cách xếp hàng | Ưu | Nhược |
|---|---|---|
| Một topic cho mọi kênh | đơn giản | email nghẽn kéo theo webhook, in-app |
| Subscription riêng mỗi kênh | cô lập kênh, scale riêng | vẫn có thể bị một webhook chết làm chậm |
| Thêm limiter + circuit breaker theo endpoint | một khách lỗi không ảnh hưởng ai | thêm trạng thái trong Redis |
- Chọn kênh riêng + token bucket Redis (email 100/s toàn cục, webhook theo endpoint) + circuit breaker; webhook lỗi liên tục 24 giờ → tạm tắt, email cho admin của khách. Cloud Tasks là lựa chọn tốt cho delivery webhook vì có rate limit và hẹn giờ theo queue; Pub/Sub vẫn dùng cho fan-out.
### Đào sâu 3: không mất, hạn chế trùng
| Điểm | Rủi ro | Biện pháp |
|---|---|---|
| Schedule service publish | lỗi sau commit → mất sự kiện | outbox |
| Impact calculator | Pub/Sub giao lại | dedup_key UNIQUE trên intent |
| Worker gửi | gửi xong nhưng chưa kịp ghi SENT | header X-Event-Id cố định, bên nhận dedup |
| Lỗi kéo dài | retry vô hạn chiếm tài nguyên | backoff có jitter, DLQ sau 10 lần, redrive có kiểm soát |
### Trade-off
- Debounce làm trễ thêm tới 10 phút để đổi lấy ít nhiễu; thay đổi lớn (≥ 24 h) có thể bỏ qua debounce.
- At-least-once nên vẫn có thể trùng hiếm hoi; chấp nhận và minh bạch bằng event id thay vì hứa exactly-once.
### Nói thế nào trong phỏng vấn (EN)
- "The average load is about one delivery per second; the design is driven by typhoon-style bursts and the email provider's limit." — Burst và giới hạn kênh quyết định thiết kế.
- "I separate the notification intent from each delivery attempt, which gives me coalescing, per-channel retries and an audit trail." — Tách intent và delivery.
- "We compare against the last ETA we actually told the customer, not the previous schedule version." — So với ETA đã báo, không phải ETA trước đó.
- "One dead webhook must never slow down anyone else, so limits and circuit breakers are per endpoint." — Cô lập lỗi theo endpoint.
- "I can guarantee no loss with outbox and at-least-once delivery; for duplicates I give receivers a stable event id." — Không mất bằng outbox, trùng thì bên nhận dedup theo event id.`
});

/* ---------- JM4 ---------- */
window.MOCKS.push({
  id: 'JM4',
  title: 'Design the customer portal front-end and BFF (Next.js + NestJS)',
  level: 2,
  prompt: `Design the customer portal for a shipping line: a public vessel schedule that must rank well in search, a container tracking page, and a logged-in dashboard for bookings and documents. Use Next.js for the front end and a NestJS BFF in front of our internal services, and explain rendering, caching, authentication and how you would run it on GCP.
Thiết kế customer portal cho hãng tàu: trang lịch tàu public cần SEO tốt, trang tracking container, dashboard đăng nhập cho booking và chứng từ. Dùng Next.js cho front-end và BFF NestJS đứng trước các service nội bộ; giải thích rendering, caching, xác thực và cách chạy trên GCP.`,
  clarify: [
    `Hỏi: Người dùng và lưu lượng? → Đáp (giả định): 50k người dùng đăng nhập hoạt động/ngày (forwarder, shipper), 500k lượt xem trang public/ngày, đỉnh theo giờ làm việc châu Á và châu Âu.`,
    `Hỏi: Ngôn ngữ? → Đáp (giả định): en, ja, zh, vi; URL có tiền tố locale để SEO; giờ hiển thị theo giờ địa phương của cảng.`,
    `Hỏi: Lịch tàu đổi thường xuyên không? → Đáp: mỗi chuyến đổi vài lần/ngày; trang public chấp nhận trễ ≤ 5 phút, thay đổi lớn thì cần làm mới sớm.`,
    `Hỏi: Xác thực? → Đáp: SSO qua OIDC với IdP của hãng, có MFA; một công ty khách có nhiều user với vai trò viewer, booker, admin.`,
    `Hỏi: Service nội bộ trông thế nào? → Đáp: booking, schedule, tracking, document (PDF B/L trên GCS), customer profile; REST nội bộ, vài service chậm (p95 ~800 ms).`,
    `Hỏi: Mục tiêu hiệu năng? → Đáp: Core Web Vitals "good" ở p75 (LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1) kể cả mạng di động ở các thị trường châu Á.`,
    `Hỏi: Gì ngoài phạm vi? → Đáp: app mobile native, thanh toán, CMS marketing (giả định đã có headless CMS).`
  ],
  phases: {
    req: {
      checks: [
        `Ba loại trang với yêu cầu khác nhau: public SEO (lịch tàu), public động (tracking), riêng tư (dashboard booking/chứng từ).`,
        `Auth: SSO OIDC + MFA, phân quyền theo công ty và vai trò; dữ liệu riêng tư không bao giờ bị cache ở tầng dùng chung.`,
        `Non-functional: Core Web Vitals good ở p75 trên mobile, trang public trễ dữ liệu ≤ 5 phút, đa ngôn ngữ, 99,9%.`,
        `BFF gộp nhiều service nội bộ, che service chậm, một API cho FE.`,
        `Observability FE: RUM Web Vitals, lỗi JS, trace FE → BFF → service.`
      ],
      hint: `Đề front-end system design: đừng nói về database. Phân loại trang theo **ai xem, dữ liệu đổi nhanh đến đâu, có cần SEO không** — ba câu hỏi đó quyết định rendering và cache. Hỏi về ngôn ngữ và thị trường vì nó ảnh hưởng URL, font, múi giờ và Web Vitals trên mạng di động.`
    },
    est: {
      checks: [
        `Public: 500k pageview/ngày ≈ 6/s, đỉnh ~60/s → phần lớn phục vụ từ CDN nếu dùng ISR (giả định).`,
        `Số trang lịch tàu: ~3 000 chuyến × 4 ngôn ngữ ≈ 12k trang → không build sẵn tất cả, dùng ISR theo yêu cầu.`,
        `Dashboard: 50k user × 30 request/ngày ≈ 1,5M/ngày ≈ 17 RPS, đỉnh ~150 RPS vào BFF; mỗi trang gộp 3–5 call → ~500–750 call nội bộ/s lúc đỉnh.`,
        `Ngân sách JS client trang public ~200 KB gzip (giả định) để giữ INP/LCP trên mobile.`,
        `Cloud Run: concurrency 80; vài instance Next + BFF lúc đỉnh, min instances 1–2 để tránh cold start.`
      ],
      hint: `Front-end estimation khác backend: tính **tỉ lệ cache hit ở CDN**, **số trang cần pre-render**, **số call nội bộ mỗi trang** (fan-out của BFF) và **ngân sách bundle**. Kết luận nên là "origin traffic is small if caching is right; the risk is BFF fan-out to slow services".`
    },
    hld: {
      checks: [
        `Sơ đồ: browser → Cloud Load Balancer + Cloud CDN → Next.js (Cloud Run) cho trang, BFF NestJS (Cloud Run) cho /api và /auth → Memorystore Redis (session, cache) → service nội bộ; IdP OIDC; Cloud Logging/Trace.`,
        `Bảng rendering theo trang: lịch tàu ISR + revalidate on-demand, tracking SSR động + cache ngắn, dashboard dynamic riêng tư.`,
        `Server Component gọi BFF bằng **URL nội bộ**, không qua domain public (tránh hairpin NAT).`,
        `API BFF theo màn hình: /api/dashboard/summary, /api/bookings, /api/tracking/{no}, /api/documents/{id}/download.`,
        `Cùng một domain cho FE và BFF → không CORS, cookie first-party.`
      ],
      hint: `Vẽ hai service Cloud Run sau một load balancer, route theo path. Sau đó chuyển ngay sang **bảng rendering theo trang** — đó là phần người phỏng vấn front-end chờ. Nhắc rằng BFF là API "theo màn hình" (screen-shaped), không phải proxy 1-1 tới service nội bộ.`
    },
    deep: {
      checks: [
        `Cache nhiều tầng CDN → Next → BFF → service: cái gì cache ở đâu, TTL bao nhiêu, invalidation bằng revalidateTag khi schedule đổi; không cache dữ liệu cá nhân ở tầng dùng chung.`,
        `ISR khi chạy nhiều instance Cloud Run: cache mặc định nằm trên từng instance → cần cache handler dùng chung (Redis/GCS) hoặc dựa vào CDN.`,
        `Auth: OIDC authorization code + PKCE ở BFF, session httpOnly SameSite=Lax trong Redis, token không xuống browser, CSRF token cho thao tác ghi, RBAC theo công ty.`,
        `Core Web Vitals: nội dung chính render server, font CJK nặng (subset hoặc font hệ thống), ảnh có kích thước, virtualize bảng, RUM bằng thư viện web-vitals.`,
        `i18n: route theo locale, hreflang, định dạng ngày giờ với timeZone của cảng ở server để tránh hydration mismatch.`,
        `Deploy: image standalone, build một lần; tránh NEXT_PUBLIC_ theo môi trường; canary bằng chia traffic revision; telemetry lỗi không được làm sập SSR.`
      ],
      hint: `Ba chỗ chắc chắn bị hỏi: (1) "where does each page get cached and how is it invalidated"; (2) "how does login work and where is the token"; (3) "ISR with several instances". Câu trả lời ghi điểm cho (3): cache ISR mặc định nằm trên filesystem của từng instance nên các instance lệch nhau. Kể chuyện thật: image FE bake endpoint telemetry localhost làm 500 toàn site — observability phải fail-safe.`
    },
    wrap: {
      checks: [
        `Tóm tắt: rendering theo trang, BFF theo màn hình cùng domain, session ở server, cache nhiều tầng với invalidation theo tag.`,
        `Trade-off: thêm BFF là thêm một hop và một service phải vận hành, đổi lại bảo mật token, gộp call, cache tập trung.`,
        `Rủi ro: cache nhầm dữ liệu riêng tư, ISR lệch giữa instance, cold start, bundle phình theo thời gian.`,
        `Bảo vệ lâu dài: Lighthouse CI + ngân sách bundle trong pipeline, RUM dashboard p75 theo quốc gia, cảnh báo lỗi JS.`
      ],
      hint: `Kết bằng cách giữ chất lượng **theo thời gian**: performance budget trong CI và RUM theo quốc gia. Front-end thường xuống cấp dần từng PR một, không phải sập một lần.`
    }
  },
  followups: [
    `Why put a BFF in front of the internal services instead of calling them directly from Next.js?`,
    `The schedule page still shows yesterday's ETA after the schedule changed. Which cache layers do you check, in what order?`,
    `You run three Cloud Run instances of Next.js. Does ISR still behave correctly?`,
    `How do you make sure a logged-in user's data is never cached at the CDN?`,
    `Walk me through the OIDC login flow end to end. Where does the session live?`,
    `How do you serve Japanese and Vietnamese pages without hurting LCP or SEO?`,
    `LCP on the tracking page is four seconds on mobile in one market. How do you investigate?`,
    `A Server Component calls the BFF through the public domain and gets connection refused inside the container. What is going on?`,
    `How do you roll out a new version of the portal safely?`,
    `What do you monitor on the front end in production?`
  ],
  rubric_notes: `### Câu trả lời mạnh có gì
- Bảng rendering **theo từng trang** có lý do (SEO, độ tươi, riêng tư), không chọn một chiến lược cho cả site.
- Cache nhiều tầng có TTL và cách invalidation cụ thể (revalidateTag khi schedule đổi), tách rõ public và private.
- Biết ISR self-host trên nhiều instance cần cache handler dùng chung.
- Auth qua BFF: OIDC code + PKCE, session httpOnly, token không xuống browser, CSRF cho thao tác ghi.
- Web Vitals đo bằng RUM ở p75, có ngân sách bundle trong CI; xử lý font CJK và múi giờ.
### Bẫy thường gặp
- Lưu access token trong localStorage; gọi service nội bộ trực tiếp từ browser (CORS, lộ topology).
- Cache trang dashboard ở CDN vì quên header private/no-store.
- Dùng NEXT_PUBLIC_ cho URL theo môi trường rồi deploy cùng một image lên nhiều môi trường.
- Server Component gọi BFF qua domain public trong container → hairpin NAT, ECONNREFUSED.
### Dấu hiệu senior
- Nói về observability FE (RUM, lỗi JS có source map riêng tư, trace FE → BFF) và performance budget như một phần thiết kế.`,
  reference: `### Yêu cầu chốt
- Functional: lịch tàu public theo tuyến/cảng/chuyến (SEO, đa ngôn ngữ); tracking theo container/booking/B/L; dashboard đăng nhập: booking, chứng từ (tải PDF B/L), thông báo; quản lý user theo công ty.
- Non-functional: Core Web Vitals good ở p75 trên mobile; dữ liệu public trễ ≤ 5 phút; dữ liệu riêng tư không bao giờ ở cache dùng chung; SSO OIDC + MFA; 99,9%.
### Ước lượng (giả định)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Pageview public | 500k / 86 400 | ~6/s, đỉnh ~60/s, phần lớn từ CDN |
| Trang lịch tàu | 3 000 chuyến × 4 ngôn ngữ | ~12k trang, ISR theo yêu cầu |
| Request dashboard | 50k user × 30 / 86 400 | ~17 RPS, đỉnh ~150 RPS |
| Fan-out BFF | 150 RPS × 3–5 call | ~500–750 call nội bộ/s |
| Ngân sách JS public | mục tiêu | ~200 KB gzip |
### Thiết kế tổng thể
:::diagram
Browser[Browser] -> LB[Cloud LB + Cloud CDN]
LB -> Next[Next.js on Cloud Run] : trang
LB -> BFF[NestJS BFF on Cloud Run] : /api, /auth
Next -> BFF : URL nội bộ
BFF -> Redis[Memorystore session + cache]
BFF -> IdP[IdP OIDC]
BFF -> Sched[Schedule svc]
BFF -> Track[Tracking svc]
BFF -> Book[Booking svc]
BFF -> Doc[Document svc + GCS]
Next -> Obs[Cloud Logging / Trace]
BFF -> Obs
:::
- Một domain: LB route /api và /auth sang BFF, còn lại sang Next → cookie first-party, không CORS. Server Component gọi BFF qua URL nội bộ của Cloud Run kèm cookie phiên; client component gọi /api cùng origin.
### Rendering theo trang
| Trang | Chiến lược | Cache | Lý do |
|---|---|---|---|
| /[locale]/schedules/... | ISR, revalidate 300 s + revalidateTag khi schedule đổi | CDN public, stale-while-revalidate | SEO, đọc nhiều, đổi chậm |
| /[locale]/tracking | SSR động, Suspense stream phần chậm | CDN 30 s cho mốc public, không cookie | dữ liệu theo request |
| /[locale]/dashboard/... | dynamic, Server Component gọi BFF bằng session | private, no-store | dữ liệu riêng tư |
| /[locale]/bookings/new | form client + gọi BFF | không cache | tương tác nặng |
### API BFF (theo màn hình)
| Method | Path | Mục đích |
|---|---|---|
| GET | /auth/login, /auth/callback | OIDC code + PKCE, tạo session |
| GET | /api/dashboard/summary | Gộp booking gần đây, cảnh báo ETA, thông báo |
| GET | /api/bookings?cursor= | Danh sách booking của công ty, lọc trạng thái |
| GET | /api/tracking/{number} | Tra container/booking/B/L, ẩn trường riêng tư nếu chưa đăng nhập |
| GET | /api/documents/{id}/download | Kiểm tra quyền, trả signed URL GCS hạn 5 phút |
### Đào sâu 1: cache nhiều tầng
| Tầng | Cache gì | TTL / invalidation |
|---|---|---|
| Cloud CDN | HTML + asset trang public | asset bất biến 1 năm (hash); HTML s-maxage 60 s + stale-while-revalidate |
| Next (Data/Route cache) | kết quả fetch và trang ISR | revalidate 300 s, revalidateTag("voyage-id") khi nhận sự kiện đổi lịch |
| BFF Redis | dữ liệu dùng chung (lịch, cảng), tóm tắt tracking | 30–60 s; dữ liệu theo user cache theo key có user/company hoặc không cache |
| Service | cache riêng của service | ngoài phạm vi portal |
- Quy tắc: response có cookie phiên luôn Cache-Control private, no-store; cache key có locale. ISR self-host trên nhiều instance: cấu hình cacheHandler dùng chung (Redis) để revalidate trên một instance có hiệu lực cho mọi instance; nếu không, các instance trả nội dung lệch nhau.
### Đào sâu 2: xác thực qua BFF
| Phương án | Ưu | Nhược |
|---|---|---|
| SPA giữ token (localStorage) | đơn giản | XSS lấy được token, CORS tới từng API |
| Token trong cookie httpOnly, FE gọi thẳng service | JS không đọc được token | lộ topology, mỗi service tự xác thực |
| BFF giữ token, browser chỉ có session cookie | token không xuống browser, gộp call, RBAC một chỗ | thêm một service và một hop |
- Chọn BFF: OIDC authorization code + PKCE; session id httpOnly Secure SameSite=Lax; Redis giữ access/refresh token, làm mới ở server; CSRF token cho thao tác ghi; guard NestJS kiểm tra vai trò và công ty; logout xoá session và gọi end-session của IdP.
### Đào sâu 3: hiệu năng, i18n, deploy, observability
- LCP: bảng lịch tàu render server, không fetch ở client; font CJK rất nặng → subset hoặc font hệ thống cho ja/zh; ảnh có width/height. INP: virtualize bảng nhiều dòng, useTransition cho bộ lọc, giữ 'use client' ở lá.
- i18n: route /en, /ja, /zh, /vi + hreflang; proxy/middleware chỉ chuyển hướng lần đầu theo Accept-Language rồi nhớ cookie; ngày giờ format ở server với timeZone của cảng để client không lệch (tránh hydration mismatch).
- Deploy: Next output standalone, build một image cho mọi môi trường, cấu hình runtime đọc ở server (tránh NEXT_PUBLIC_ theo môi trường); Cloud Run min instances 1–2, chia traffic revision để canary; secret trong Secret Manager.
- Observability: RUM web-vitals gửi /api/rum, lỗi JS với source map upload riêng; OpenTelemetry trace từ Next qua BFF tới service; exporter lỗi chỉ log, không làm SSR trả 500.
### Trade-off
- BFF thêm một hop (~1–5 ms nội bộ) và một service để vận hành, đổi lại bảo mật token, gộp call, cache và RBAC tập trung.
- ISR cho nội dung trễ tối đa một chu kỳ revalidate; bù bằng revalidate theo tag khi có sự kiện đổi lịch.
### Nói thế nào trong phỏng vấn (EN)
- "I choose rendering per page: ISR for the public schedule, dynamic SSR for tracking, and private uncached rendering for the dashboard." — Chọn rendering theo từng trang.
- "Tokens never reach the browser; the BFF owns the OIDC flow and the browser only holds an httpOnly session cookie." — Token không xuống browser.
- "Anything that depends on the session is marked private and no-store, so the CDN can never serve one customer's data to another." — Dữ liệu theo phiên không bao giờ vào CDN.
- "With several instances, ISR needs a shared cache handler, otherwise each instance revalidates on its own schedule." — ISR nhiều instance cần cache dùng chung.
- "Server components call the BFF on its internal address, which also avoids the hairpin problem I've hit before." — Gọi BFF bằng địa chỉ nội bộ, tránh hairpin.`
});
