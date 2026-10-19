/* ===== cases2.js: 9 bài case C11–C19 (payment, metrics, ad-click, proximity, message queue, hotel,
   crawler, job scheduler, SBOM platform capstone) + 9 đề mock M11–M19 tương ứng ===== */
window.LESSONS_C2 = [
{ id: 'C11', type: 'case', topic: 'consistency', title: 'Case: Design a payment system', time: '120 phút',
  goal: 'Thiết kế được hệ thống thanh toán qua PSP với ledger double-entry append-only, idempotency end-to-end, webhook + reconciliation, và lý giải vì sao chọn consistency thay vì availability.',
  md: `
## Đề bài
> "Design a payment system for an e-commerce platform. Customers pay through a third-party PSP such as Stripe, the platform records every money movement, and merchants get paid out. Money must never be lost, duplicated, or charged twice."

Dịch: Thiết kế hệ thống thanh toán cho sàn thương mại điện tử. Khách trả tiền qua PSP (Payment Service Provider — bên xử lý thẻ như Stripe), hệ thống ghi lại mọi chuyển động tiền và trả tiền cho merchant. Tiền không được mất, không được nhân đôi, không được charge hai lần. Thời gian 45 phút.

## 1. Làm rõ yêu cầu (5 phút)
- Hỏi: Mình tự xử lý thẻ hay đi qua PSP? → Đáp: qua PSP (Stripe). Không lưu số thẻ, PCI DSS để PSP lo.
- Hỏi: Chỉ pay-in (thu tiền) hay cả pay-out (trả merchant)? → Đáp: cả hai; pay-out gộp theo ngày.
- Hỏi: Quy mô? → Đáp: 1 triệu giao dịch/ngày, 90% thẻ, còn lại ví điện tử.
- Hỏi: Có cần số dư nội bộ (wallet) cho merchant? → Đáp: có, merchant xem được số dư và lịch sử.
- Hỏi: Khi PSP sập thì sao? → Đáp: chấp nhận từ chối thanh toán, tuyệt đối không "đoán" là đã thu tiền.
- Hỏi: Nhiều tiền tệ? → Đáp: có, nhưng không quy đổi tỉ giá real-time.

Chốt lại:
- **Functional**: tạo payment order cho giỏ hàng (có thể nhiều merchant); thu tiền qua PSP; ghi ledger mọi chuyển động tiền; xem trạng thái giao dịch; pay-out cho merchant; đối soát (reconciliation) với PSP.
- **Non-functional**: đúng tuyệt đối (không mất tiền, không charge đúp) quan trọng hơn sẵn sàng; độ trễ API vài trăm ms chấp nhận được; durable; audit được từng đồng.
- **Ngoài phạm vi**: chống gian lận, lưu thẻ, tỉ giá, kế toán thuế.

## 2. Ước lượng (5 phút)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| TPS trung bình | 10^6 giao dịch / 10^5 s | ~10 TPS |
| TPS đỉnh | ×10 (ngày sale) | ~100 TPS |
| Bản ghi mỗi giao dịch | 1 payment_order + ~2 payment_event + 4 ledger_entry | ~7 dòng |
| Dung lượng/ngày | 10^6 × 7 dòng × ~300 B | ~2 GB |
| Dung lượng/năm | 2 GB × 365 | ~0,75 TB |
| Webhook từ PSP | ~2 sự kiện/giao dịch | ~2 triệu/ngày, ~25/s |

Kết luận cần nói ra miệng: **đây không phải bài về throughput**. 100 TPS một Postgres xử lý thoải mái. Toàn bộ độ khó nằm ở correctness: retry, trùng lặp, thứ tự sự kiện, và tiền phải khớp đến từng đồng.

## 3. Thiết kế tổng thể (10–12 phút)
:::diagram
Client[Web / Mobile] -> GW[API gateway] : HTTPS + Idempotency-Key
GW -> Pay[Payment service]
Pay -> PayDB[Payment DB Postgres]
Pay -> PSP[PSP Stripe] : create PaymentIntent
PSP -> Hook[Webhook handler] : payment.succeeded
Hook -> Pay : verify HMAC + enqueue
Pay -> Ledger[Ledger service]
Ledger -> LedgerDB[Ledger DB append-only]
Pay -> Wallet[Wallet service] : credit merchant
Recon[Reconciliation job] -> PSP : settlement report
Recon -> LedgerDB
Payout[Payout service] -> PSP : transfer
:::

**Luồng ghi (pay-in)**: (1) client gửi POST /payments kèm Idempotency-Key; (2) Payment service tạo payment_order trạng thái [[CREATED]], gọi PSP tạo PaymentIntent với idempotency key = payment_order_id; (3) trả client_secret để client hoàn tất ở phía PSP; (4) PSP gửi webhook [[payment.succeeded]]; (5) handler xác minh chữ ký, ghi event, chuyển trạng thái [[SUCCEEDED]], ghi ledger và cộng wallet trong **một transaction** nếu chung DB, hoặc qua saga nếu tách service.

**Luồng đọc**: GET /payments/{id} đọc Payment DB; read replica được phép vì trạng thái cuối đã durable và client chấp nhận trễ vài trăm ms.

| Endpoint | Mô tả | Ghi chú |
|---|---|---|
| POST /v1/payments | Tạo payment order | Header Idempotency-Key bắt buộc |
| GET /v1/payments/{id} | Trạng thái giao dịch | Trả kèm lịch sử event |
| POST /v1/webhooks/psp | Nhận sự kiện từ PSP | Xác minh HMAC, trả 200 nhanh |
| POST /v1/payouts | Tạo lệnh trả merchant | Chạy theo batch ngày |
| GET /v1/accounts/{id}/balance | Số dư từ ledger | snapshot + entries mới |

Mô hình dữ liệu:
| Bảng | Cột chính | Ghi chú |
|---|---|---|
| payment_order | id UUID, buyer_id, idempotency_key UNIQUE, amount_minor BIGINT, currency, status, psp_intent_id | state machine, không xoá |
| payment_event | id, order_id, psp_event_id UNIQUE, type, payload, received_at | lưu mọi webhook, kể cả trùng |
| ledger_entry | id, tx_id, account_id, side DEBIT/CREDIT, amount_minor, currency, created_at | **chỉ INSERT**, không UPDATE/DELETE |
| account | id, owner_type, owner_id, currency, snapshot_balance, snapshot_at | số dư = snapshot + SUM entries sau snapshot |

Tiền lưu dạng **số nguyên đơn vị nhỏ nhất** (cent, yen) kèm mã tiền tệ. Không bao giờ dùng float: 0,1 + 0,2 không bằng 0,3 trong IEEE 754.

## 4. Đào sâu (15–18 phút)
### 4.1 Exactly-once trên đường truyền chỉ cho at-least-once
Vấn đề: client timeout rồi retry; mình gọi PSP timeout rồi retry; PSP gửi webhook 2 lần. Không có cách nào biết request trước "đã tới hay chưa".
| Phương án | Cách làm | Nhược |
|---|---|---|
| At-most-once (không retry) | Lỗi mạng thì báo lỗi, không gửi lại | Mất giao dịch thật, khách bực |
| At-least-once + idempotency key | Retry thoải mái; server dedup theo key | Phải thiết kế key ở **mọi** hop |
| Distributed transaction (2PC) với PSP | Khoá hai bên | PSP không hỗ trợ, blocking, latency cao |

Chọn phương án 2 và áp **end-to-end**: client → mình (header Idempotency-Key, UNIQUE constraint, trả lại response cũ nếu trùng); mình → PSP (Stripe nhận header Idempotency-Key, dùng payment_order_id); PSP → mình (psp_event_id UNIQUE trong payment_event, [[INSERT ... ON CONFLICT DO NOTHING]] rồi mới xử lý). Retry theo exponential backoff có jitter, nhưng **chỉ retry lỗi retryable** (timeout, 5xx, 429); lỗi nghiệp vụ như card_declined không retry.

### 4.2 Ledger double-entry, append-only
Vấn đề: cột [[balance]] cập nhật tại chỗ thì khi lệch không biết lệch từ đâu, không chứng minh được "tiền đi đâu".
| Phương án | Ưu | Nhược |
|---|---|---|
| Cột balance mutable | Đơn giản, đọc nhanh | Không audit được, race condition, lệch âm thầm |
| Ledger append-only thuần | Lịch sử đầy đủ, bất biến | Tính số dư phải SUM hàng triệu dòng |
| Ledger + snapshot định kỳ | Audit đầy đủ, đọc nhanh | Phức tạp hơn một chút |

Chọn phương án 3. Mỗi giao dịch là một [[tx_id]] với ít nhất 2 dòng: DEBIT tài khoản receivable từ PSP, CREDIT tài khoản merchant, cộng dòng phí nền tảng. Bất biến: **tổng DEBIT = tổng CREDIT trong mỗi tx_id**, kiểm tra bằng job hoặc constraint. Sửa sai bằng bút toán đảo (reversal entry), không sửa dòng cũ.

### 4.3 Webhook không đáng tin: cần poll và reconciliation
Thực tế: webhook có thể trùng, đến sai thứ tự ([[succeeded]] tới trước [[processing]]), hoặc mất hẳn khi endpoint mình down 24 giờ.
- Handler làm ít nhất có thể: xác minh HMAC, insert payment_event, trả 200, đẩy vào queue nội bộ. Xử lý nặng ở consumer.
- Trạng thái chỉ **đi tới**, không lùi: [[CREATED → PROCESSING → SUCCEEDED hoặc FAILED]]; event cũ đến muộn bị bỏ qua nhờ UPDATE có điều kiện WHERE status = trạng thái trước.
- Order ở [[PROCESSING]] quá 15 phút → job poll PSP [[GET /payment_intents/{id}]] lấy sự thật.
- **Reconciliation hằng ngày**: tải settlement report của PSP, so với ledger theo từng giao dịch; chênh lệch ghi vào bảng [[recon_mismatch]] cho người xử lý. Đây là lưới an toàn cuối cùng và người phỏng vấn senior luôn hỏi tới.

### 4.4 Wallet và pay-out: saga thay vì transaction xuyên service
Khi Payment, Ledger, Wallet là 3 service với 3 DB thì không có ACID chung. Dùng **saga**: chuỗi local transaction, mỗi bước có bước bù (compensating action). Pay-out: (1) Wallet hold tiền → (2) PSP transfer → (3) Ledger ghi → thành công thì Wallet chốt, thất bại thì Wallet release. Orchestration (một service điều phối, có bảng trạng thái saga) dễ debug hơn choreography (service tự nghe event) khi luồng dài. Nếu quy mô cho phép, gộp Payment + Ledger vào **một DB** để dùng ACID: đơn giản luôn thắng.

## 5. Trade-off & câu hỏi vặn (5 phút)
- *Why consistency over availability here?* → Giao dịch bị từ chối thì khách thử lại; giao dịch charge đúp thì mất uy tín và tốn chi phí hoàn tiền. Mất availability vài phút rẻ hơn mất đúng đắn.
- *Client không gửi Idempotency-Key thì sao?* → Từ chối 400. Key là bắt buộc, không optional.
- *Idempotency key lưu bao lâu?* → Theo cửa sổ retry hợp lý, ví dụ 24 giờ (Stripe cũng giữ 24 giờ). Sau đó key cũ được coi là request mới.
- *Hai request cùng key đến đồng thời?* → UNIQUE constraint làm trọng tài: request thứ hai nhận conflict, rồi đọc lại kết quả của request thứ nhất hoặc trả 409 "in progress".
- *Vì sao không dùng float hoặc DECIMAL?* → Float sai số nhị phân; DECIMAL đúng nhưng driver/ORM hay chuyển về float ngầm. BIGINT minor unit + currency là chuẩn ngành.
- *Webhook đến trước khi transaction tạo order commit?* → Có thể xảy ra. Handler không tìm thấy order thì trả 500 để PSP retry, hoặc đẩy vào queue delay 5 giây.
- *Làm sao biết hệ thống đang mất tiền mà không ai thấy?* → Metric: số order PROCESSING quá 15 phút, số mismatch sau reconcile, tỉ lệ webhook lỗi. Chưa có alert nghĩa là chưa xong.
- *Ledger lớn thì tính balance thế nào?* → Snapshot số dư hằng ngày; balance = snapshot + SUM entries sau snapshot_at; index (account_id, created_at).

## 6. Người phỏng vấn chấm gì
| Tiêu chí | Câu trả lời yếu | Câu trả lời mạnh |
|---|---|---|
| Hiểu bản chất bài | Vẽ nhiều service, nói về scale | Nói ngay: 100 TPS là nhỏ, bài này về correctness |
| Idempotency | "Dùng idempotency key" chung chung | Chỉ ra key ở từng hop và cơ chế dedup (UNIQUE) |
| Ledger | Cột balance UPDATE | Double-entry append-only + snapshot, bút toán đảo |
| Xử lý lỗi | Tin webhook tuyệt đối | Poll fallback + reconciliation hằng ngày |
| Trade-off | Kể CAP theo sách | Giải thích vì sao từ chối giao dịch tốt hơn charge đúp |

**Nói thế nào trong phỏng vấn (EN)**
- "This is a correctness problem, not a throughput problem: a hundred TPS is trivial, double charging is not." — Bài này về tính đúng, không phải throughput.
- "I will make every hop idempotent so I can retry aggressively without side effects." — Làm mọi hop idempotent để retry mạnh tay mà không gây tác dụng phụ.
- "The ledger is append-only and double-entry; balances are derived, never the source of truth." — Ledger chỉ thêm, bút toán kép; số dư là dẫn xuất.
- "Webhooks are a hint, not the truth; I poll the PSP and reconcile daily against its settlement report." — Webhook chỉ là gợi ý; poll và đối soát mới là sự thật.
- "Money is stored as integers in minor units with a currency code; floats never touch money." — Tiền là số nguyên đơn vị nhỏ nhất kèm mã tiền tệ.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Hệ SBOM không có tiền nhưng có đúng bài toán "at-least-once + idempotent": upload bị retry, Lambda gọi lại, sweeper chạy lại. Với mỗi hop hãy hỏi: key dedup là gì, constraint nào bảo vệ?
- Sự cố #12 (publish audit log trước khi commit) chính là "webhook đến trước khi order tồn tại": dùng transactional outbox, ghi event vào bảng outbox trong cùng transaction, relay publish sau commit.
- Sự cố #7 (một coordinate hỏng làm failed cả batch) tương đương "retry 4xx như 5xx": phân loại lỗi retryable/non-retryable **per item**, không nuốt lỗi cả batch.
- Status machine enrichment (pending → enriched, failed, no_locator) phải "đi tới, không lùi" như payment state machine: mọi UPDATE kèm WHERE status = trạng thái cũ, tránh sweeper ghi đè kết quả inline (sự cố kiểu 2128 trong memory).
- Reconciliation hằng ngày cho SBOM: job đếm component có license ở bảng PRCL nhưng view tenant chưa thấy (sự cố #15), và pending quá 1 giờ. Ghi vào bảng mismatch, không chỉ log.
- Phân loại lỗi khi gọi ClearlyDefined, OSV: timeout, 429, 5xx thì retry với backoff theo host; 400 do coordinate sai thì no_locator ngay, không retry, y hệt card_declined.
- Idempotency key cho Lambda invoke: batch_id = hash(danh sách coordinate đã sort) để Lambda bị gọi lại không ghi kết quả hai lần.
- Ledger append-only gợi ý bảng enrichment_history chỉ INSERT (component, source, status, error, at) để truy vết vì sao một dòng failed; hiện last_error bị ghi đè nên mất lịch sử.
- Việc tuần này: (1) thêm idempotency_key UNIQUE cho import job; (2) viết ADR "Outbox cho audit/notification"; (3) dựng alert "pending quá 15 phút" giống alert "order PROCESSING quá 15 phút".
`,
  quiz: [
    { t: 'mc', q: 'Lý do chính để ledger thanh toán là append-only (chỉ INSERT) thay vì UPDATE cột balance?', o: ['INSERT nhanh hơn UPDATE trong Postgres', 'Để tránh phải dùng transaction', 'Mọi thay đổi tiền đều có vết, sửa sai bằng bút toán đảo, audit được', 'Để dễ shard theo account_id'], a: 2, why: 'Append-only giữ lịch sử bất biến; số dư là dẫn xuất, lệch ở đâu truy được ở đó.' },
    { t: 'mc', q: 'Client gửi lại POST /payments với cùng Idempotency-Key trong khi request đầu vẫn đang xử lý. Server nên làm gì?', o: ['Trả 409 hoặc chờ rồi trả lại kết quả của request đầu', 'Tạo payment order mới vì request đầu chưa xong', 'Huỷ request đầu và xử lý request mới', 'Trả 200 với body rỗng'], a: 0, why: 'UNIQUE constraint làm trọng tài; request trùng không được tạo side effect mới.' },
    { t: 'mc', q: 'Cách lưu số tiền đúng chuẩn trong hệ thống thanh toán?', o: ['FLOAT8 vì đủ chính xác cho 2 chữ số thập phân', 'VARCHAR để giữ nguyên định dạng hiển thị', 'DECIMAL(10,2) ở DB và float ở ứng dụng', 'BIGINT theo đơn vị nhỏ nhất (cent, yen) kèm mã tiền tệ'], a: 3, why: 'Số nguyên minor unit tránh sai số nhị phân và tránh driver đổi ngầm sang float.' },
    { t: 'mc', q: 'PSP gửi webhook payment.succeeded hai lần cho cùng một giao dịch. Cơ chế nào ngăn cộng tiền hai lần?', o: ['Giảm timeout của webhook endpoint', 'UNIQUE trên psp_event_id và INSERT ... ON CONFLICT DO NOTHING trước khi xử lý', 'Chỉ nhận webhook từ IP của PSP', 'Xử lý webhook tuần tự bằng một worker duy nhất'], a: 1, why: 'Dedup theo id sự kiện của PSP là cách idempotent; xử lý tuần tự không ngăn được trùng.' },
    { t: 'mc', q: 'Gọi PSP nhận lỗi card_declined. Hành động đúng?', o: ['Retry với exponential backoff 3 lần', 'Chuyển sang PSP dự phòng rồi thử lại', 'Không retry, chuyển order sang FAILED và báo khách', 'Giữ order ở PROCESSING chờ webhook'], a: 2, why: 'card_declined là lỗi nghiệp vụ không retryable; chỉ retry timeout, 5xx, 429.' },
    { t: 'fill', q: 'Điền: bên thứ ba xử lý thẻ và chuyển tiền thay cho sàn (Stripe, Adyen) gọi chung là ___.', a: ['psp', 'payment service provider'], why: 'PSP gánh phần PCI DSS và kết nối ngân hàng, mình chỉ giữ trạng thái và ledger.' },
    { t: 'fill', q: 'Điền: chuỗi local transaction xuyên nhiều service, mỗi bước có hành động bù khi thất bại, gọi là ___.', a: ['saga', 'saga pattern'], why: 'Saga thay cho distributed transaction khi mỗi service có DB riêng.' },
    { t: 'open', q: 'Endpoint webhook của bạn down 24 giờ, PSP đã ngừng retry. Trình bày cách phát hiện và khôi phục các giao dịch bị kẹt mà không charge đúp.', a: 'Không tin webhook là nguồn sự thật duy nhất. Job định kỳ quét payment_order ở PROCESSING quá 15 phút và poll PSP GET /payment_intents/{id} để lấy trạng thái thật, cập nhật theo state machine chỉ đi tới. Mọi cập nhật idempotent nhờ UNIQUE psp_event_id và UPDATE có điều kiện. Reconciliation hằng ngày với settlement report của PSP bắt những gì poll bỏ sót, chênh lệch ghi vào recon_mismatch. Có alert trên số order kẹt và số mismatch để không lặp lại tình trạng im lặng 24 giờ.', keys: ['poll', 'reconciliation', 'state machine', 'idempotent', 'alert'] }
  ]
},
{ id: 'C12', type: 'case', topic: 'observability', title: 'Case: Design a metrics monitoring and alerting system', time: '120 phút',
  goal: 'Thiết kế được pipeline metric (pull/push → Kafka → TSDB hot/cold), ước lượng cardinality, nén và downsampling bằng số, và thiết kế alert manager có for-duration, dedup, silence, route và alert "không có dữ liệu".',
  md: `
## Đề bài
> "Design a metrics monitoring and alerting system for a company that runs about 100 thousand servers. Engineers must be able to query and visualize metrics, define alert rules, and get notified when something goes wrong."

Dịch: Thiết kế hệ thống giám sát metric và cảnh báo cho công ty có khoảng 100 nghìn máy chủ. Kỹ sư truy vấn và vẽ biểu đồ metric, định nghĩa rule cảnh báo, và nhận thông báo khi có sự cố. Thời gian 45 phút.

## 1. Làm rõ yêu cầu (5 phút)
- Hỏi: Metric gì, chỉ hệ điều hành (CPU, RAM, disk) hay cả nghiệp vụ (RPS, error rate)? → Đáp: cả hai; chỉ time series dạng số, không log, không trace.
- Hỏi: Quy mô? → Đáp: 1 000 pool × 100 máy = 100k máy, ~100 metric mỗi máy, thu mỗi 10 giây.
- Hỏi: Giữ bao lâu? → Đáp: raw 7 ngày, độ phân giải 1 phút trong 30 ngày, 1 giờ trong 1 năm.
- Hỏi: Kiểu truy vấn? → Đáp: dashboard avg/p99/rate theo cửa sổ thời gian và group by label; alert là rule định kỳ.
- Hỏi: Độ trễ chấp nhận? → Đáp: điểm mới hiện trên dashboard trong 1 phút; alert nổ trong 1–2 chu kỳ đánh giá.
- Hỏi: Multi-tenant, billing? → Đáp: không.

Chốt lại:
- **Functional**: thu metric từ host và job ngắn hạn; lưu nhiều năm với độ phân giải giảm dần; query theo label và hàm gộp; alert rule với ngưỡng và thời gian; thông báo qua email, Slack, PagerDuty.
- **Non-functional**: ghi 1 triệu điểm/giây ổn định; mất một phần điểm khi sự cố là chấp nhận được (metric là xấp xỉ), nhưng **alert không được im lặng**; query dashboard dưới 2 giây.
- **Ngoài phạm vi**: log, distributed tracing, anomaly detection bằng ML.

## 2. Ước lượng (5 phút)
Thống nhất đơn vị trước: 1 **series** = 1 tên metric + 1 tập label cố định; 1 **điểm** = (timestamp, value).
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Số series | 100 000 máy × 100 metric | 10 triệu series |
| Điểm ghi/giây | 10^7 / 10 s | 1 triệu điểm/s |
| Điểm/ngày | 10^6 × 86 400 | ~86 tỷ điểm/ngày |
| Raw chưa nén | 86 tỷ × 16 B (ts 8 B + value 8 B) | ~1,4 TB/ngày |
| Raw nén Gorilla ~1,4 B/điểm | 86 tỷ × 1,4 B | ~120 GB/ngày, 7 ngày ≈ 850 GB |
| Downsample 1 phút, 30 ngày | 10^7 × 1 440 × 30 × ~2 B | ~860 GB |
| Downsample 1 giờ, 1 năm | 10^7 × 8 760 × ~2 B | ~175 GB |
| Query dashboard | 1 000 kỹ sư, dashboard refresh 30 s | vài trăm QPS, mỗi query quét hàng nghìn series |

Nếu đề nói "100 triệu metric mỗi ngày", hãy hỏi lại đơn vị. 100 triệu **điểm**/ngày chỉ ~1 200 điểm/s, một node TSDB thừa sức; 100 triệu **series** thì cần cụm hàng chục node và cardinality là vấn đề số một. Hỏi lại đúng chỗ này là dấu hiệu senior.

## 3. Thiết kế tổng thể (10–12 phút)
:::diagram
Agent[Metrics agent trên host] -> Collector[Collector pull + push gateway] : scrape 10 s
Collector -> Kafka[Kafka buffer] : partition theo hash series
Kafka -> Writer[Ingest consumer]
Writer -> TSDB[TSDB hot 7 ngày]
TSDB -> Cold[Object storage lạnh] : downsample + ship block
Query[Query service] -> TSDB
Query -> Cold
Query -> QCache[Query cache]
Dash[Dashboard] -> Query
Alert[Alert manager] -> Query : eval rule mỗi 30 s
Alert -> AlertStore[Alert state store]
Alert -> Notify[Email / Slack / PagerDuty]
:::

**Luồng ghi**: agent expose endpoint /metrics; collector lấy danh sách target từ service discovery và scrape mỗi 10 s; job ngắn hạn và Lambda push vào push gateway để collector scrape thay. Collector đẩy vào Kafka (partition theo hash series để cùng series luôn về cùng consumer) nhằm tách tốc độ ghi khỏi TSDB; consumer ghi TSDB theo batch. **Luồng đọc**: dashboard gọi Query service; khoảng thời gian gần (≤7 ngày) vào hot TSDB, xa hơn vào cold storage đã downsample; kết quả cache ngắn vì dashboard hỏi lặp lại cùng câu.

| Endpoint | Mô tả | Ghi chú |
|---|---|---|
| POST /v1/write | Agent hoặc gateway ghi điểm | batch, nén snappy |
| GET /v1/query?q=...&start=...&end=...&step=... | Truy vấn range | chọn tier theo start/step |
| GET /v1/series?match=... | Tìm series theo label | đánh vào inverted index |
| POST /v1/rules | Tạo/sửa alert rule | expr, for, labels, annotations |
| POST /v1/silences | Tắt tiếng theo matcher label | có start, end |

Mô hình dữ liệu:
| Bảng hoặc cấu trúc | Key | Ghi chú |
|---|---|---|
| series | series_id = hash(metric_name + labels đã sort) → labels | inverted index label=value → danh sách series_id |
| chunk | (series_id, start_ts) → bytes nén | 2 giờ/chunk, chunk đóng là bất biến |
| block | khoảng thời gian → tập chunk + index | đơn vị để retention và ship sang cold |
| alert_rule | rule_id → expr, for, labels, route | lưu Postgres |
| alert_state | fingerprint(rule + labels) → pending/firing/resolved, since | persist để restart không gửi lại |

## 4. Đào sâu (15–18 phút)
### 4.1 Push hay pull?
| Tiêu chí | Pull (Prometheus) | Push (Graphite, agent Datadog) |
|---|---|---|
| Biết target sống hay chết | Có ngay: scrape fail = up 0 | Phải suy ra từ sự im lặng |
| Job ngắn hạn, serverless | Khó, cần push gateway | Tự nhiên |
| Firewall và NAT | Collector phải tới được host | Host chỉ cần ra ngoài |
| Kiểm soát tải | Collector điều tiết nhịp | Client bùng nổ có thể đè server |
| Debug | curl /metrics là thấy ngay | Phải lần log của agent |

Chọn pull làm mặc định cho hạ tầng mình quản lý, thêm push gateway cho batch job và Lambda. Dù chọn gì cũng để Kafka ở giữa: chịu burst, cho TSDB bảo trì mà không mất điểm, và cho phép thêm consumer khác (ví dụ stream alert) sau này.

### 4.2 Time-series DB: cardinality là kẻ thù số một
- Series do tập label quyết định. Thêm label [[user_id]] có 1 triệu giá trị nghĩa là nhân số series lên 1 triệu lần, index nổ, RAM nổ. Quy tắc: label chỉ dùng cho giá trị **hữu hạn và nhỏ** (host, region, status_code, tenant khi chỉ có 100 tenant).
- Nén Gorilla: delta-of-delta cho timestamp, XOR cho value; trung bình 1,37 B/điểm thay vì 16 B (bài báo Gorilla, VLDB 2015), tức nén ~12 lần.
- Lưu theo **chunk** 2 giờ cho mỗi series trong RAM rồi flush thành block bất biến trên SSD; inverted index label → series_id để tìm series theo label nhanh. Đây là cách Prometheus TSDB làm.
- Downsampling: với mỗi series tính min, max, **sum, count** theo 1 phút rồi 1 giờ. Phải giữ sum và count chứ không chỉ avg, vì avg của avg là sai khi gộp tiếp.
- Retention theo tier: xoá block raw quá 7 ngày; block downsample đẩy sang object storage (cách Thanos, Cortex, Mimir làm).

| Phương án lưu | Ưu | Nhược |
|---|---|---|
| Postgres thuần | Quen thuộc, có SQL | 1 triệu insert/s là quá sức, không nén theo series |
| Cassandra wide-row | Ghi mạnh, scale ngang | Không nén chuyên, gộp theo label yếu |
| TSDB chuyên dụng (Prometheus, M3, InfluxDB) | Nén 10 lần, query theo label, downsample sẵn | Thêm công nghệ; cardinality vẫn phải quản bằng kỷ luật |

### 4.3 Alert manager: không chỉ là so sánh ngưỡng
Rule ví dụ: [[avg_over_time(cpu_usage[5m]) > 0.9 for 10m]]. Alert manager đánh giá rule mỗi 30 s qua Query service và giữ state machine pending → firing → resolved.
- **For duration**: chỉ firing khi điều kiện đúng liên tục N phút, tránh flapping.
- **Grouping và dedup**: 100 máy cùng pool cùng lỗi → một thông báo nhóm theo label pool, không 100 tin nhắn; dedup theo fingerprint của tập label.
- **Silence**: tắt tiếng theo matcher label trong khoảng thời gian bảo trì.
- **Inhibition**: khi "datacenter down" đang firing thì chặn các alert con "host down".
- **Route**: cây routing theo label (team=payment → PagerDuty, severity=warning → Slack).
- **Absent / no-data alert**: cảnh báo khi series **không còn điểm nào** hoặc counter thành công **không tăng** trong N phút. Đây là alert hay bị quên nhất và là alert duy nhất bắt được "cron im lặng nhiều ngày".
Trạng thái alert phải persist (DB hoặc Kafka compacted topic); nếu để trong RAM, mỗi lần restart sẽ gửi lại hoặc quên hẳn alert đang firing.

### 4.4 Query service: chọn tier và cache
Query 30 ngày trên 1 000 series raw = 1 000 × 259 200 điểm ≈ 260 triệu điểm, không thể trả trong 2 giây. Query service chọn tier theo khoảng thời gian và step: 1 phút (43 triệu điểm) hoặc 1 giờ (720 nghìn điểm). Cache kết quả theo (query, bucket thời gian đã làm tròn) vì dashboard refresh 30 s hỏi lại gần như y hệt; chỉ cần tính phần đuôi mới.

## 5. Trade-off & câu hỏi vặn (5 phút)
- *Why Kafka in the middle, is it not extra latency?* → Thêm vài trăm ms nhưng đổi lấy khả năng chịu burst, TSDB bảo trì không mất điểm, và replay khi consumer lỗi. Metric chịu được trễ 1 phút.
- *What if the alert manager itself dies?* → Chạy 2–3 instance với gossip hoặc leader election, state persist, và một "dead man's switch": alert luôn firing gửi tới dịch vụ ngoài, nếu dịch vụ ngoài không nhận nữa là alert manager chết.
- *How do you stop cardinality explosions?* → Giới hạn số series mỗi job và mỗi metric ở collector, từ chối label mới khi vượt, dashboard top cardinality.
- *Why not store averages only when downsampling?* → Vì avg không gộp được tiếp; cần sum và count, cộng thêm min, max để không mất đỉnh.
- *Pull or push for Lambda functions?* → Push qua gateway, vì Lambda sống vài giây và không có địa chỉ cố định.
- *How to query across hot and cold?* → Query service tách khoảng thời gian, fan-out tới hai tier, merge kết quả; cold đọc theo block index.
- *Sampling or aggregation at the agent?* → Agent có thể gộp sẵn histogram bucket, nhưng không nên bỏ điểm vì counter cần liên tục để tính rate.
- *How do you alert on something that stopped happening?* → Rule absent hoặc rate của counter thành công bằng 0 trong N phút, kèm for 10m để tránh nhiễu.

## 6. Người phỏng vấn chấm gì
| Tiêu chí | Câu trả lời yếu | Câu trả lời mạnh |
|---|---|---|
| Ước lượng | Nhảy thẳng vào vẽ hộp | Phân biệt series và điểm, ra 1 triệu điểm/s, nén còn 120 GB/ngày |
| Lưu trữ | "Dùng NoSQL" | Chunk, nén Gorilla, inverted index, downsample giữ sum và count |
| Thu thập | Chọn push hay pull theo thói quen | Bảng so sánh, chọn pull + gateway, Kafka buffer |
| Alert | So ngưỡng rồi gửi mail | for-duration, grouping, silence, inhibition, route, absent alert, state persist |
| Vận hành | Không nói | Cardinality limit, dead man's switch, alert cho chính hệ thống monitoring |

**Nói thế nào trong phỏng vấn (EN)**
- "Let me pin down the unit first: ten million series scraped every ten seconds is one million points per second." — Chốt đơn vị trước: 10 triệu series, 10 giây một lần là 1 triệu điểm/giây.
- "Cardinality, not volume, is what kills a TSDB, so labels are restricted to low-cardinality dimensions." — Cardinality mới là thứ giết TSDB, label chỉ cho chiều ít giá trị.
- "I keep raw data for a week and downsample with sum and count so I can still aggregate correctly later." — Giữ raw một tuần, downsample giữ sum và count để gộp đúng về sau.
- "The alert manager needs for-duration, grouping, silences and routing, plus an absent alert for things that silently stop." — Alert manager cần for, grouping, silence, routing và alert cho thứ im lặng dừng.
- "Monitoring must monitor itself: a dead man's switch tells us when the alerting pipeline is down." — Hệ giám sát phải tự giám sát bằng dead man's switch.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Sự cố #1 (RabbitMQ publisher chết im lặng nhiều ngày) và #2 (Lambda mất env, pending kẹt hàng giờ) đều là lỗi **không có alert dạng absent**. Thêm ngay rule: counter enrichment_success_total không tăng trong 15 phút, và cron_run_total theo job không tăng trong 2 chu kỳ.
- Metric tối thiểu cho pipeline enrichment: pending_age_seconds (max tuổi dòng pending), sweep_rows_processed (sự cố #8: 0 dòng nhiều giờ là dấu hiệu), external_call_total theo source và status, policy_eval_duration_seconds.
- Cardinality: label tenant_id với 100 tenant là ổn; label target_id (1 000) tạm được; label component_id hay purl tuyệt đối không, dùng log hoặc exemplar.
- Worker và Lambda sống ngắn: Lambda push qua push gateway hoặc CloudWatch; worker Go expose /metrics bằng client_golang và để Prometheus scrape qua docker network.
- Watchtower redeploy làm restart Prometheus thì mất state alert nếu không mount volume; mount volume cho data và dùng Alertmanager tách riêng.
- Dead man's switch: một alert luôn firing gửi tới dịch vụ heartbeat bên ngoài; không nhận được thì gọi người.
- Grouping theo tenant_id và source để một nguồn ngoài chết không sinh 100 alert riêng lẻ; silence theo label env=canary khi bảo trì có kế hoạch.
- Dashboard 30 ngày cho báo cáo SLA với khách phải đọc bản downsample; Prometheus giữ 7 ngày raw, thêm Thanos hoặc Mimir nếu cần giữ 1 năm.
- Việc tuần này: viết file rule cho 4 metric trên, dựng dashboard "Enrichment health" với panel tuổi pending và tỉ lệ failed theo source, review cùng team xem alert nào hôm 28/7 đã bắt được sự cố.
`,
  quiz: [
    { t: 'mc', q: 'Nguyên nhân phổ biến nhất làm một TSDB như Prometheus hết RAM dù lượng điểm ghi không đổi?', o: ['Scrape interval quá ngắn', 'Thêm label có quá nhiều giá trị (ví dụ user_id), số series bùng nổ', 'Retention raw quá dài', 'Dashboard query quá nhiều'], a: 1, why: 'Mỗi tập label mới là một series với chunk và index riêng; cardinality quyết định RAM.' },
    { t: 'mc', q: 'Khi downsample từ 10 giây sang 1 phút, nên lưu gì để sau này gộp tiếp sang 1 giờ vẫn đúng?', o: ['avg là đủ', 'sum, count, min, max', 'median và p99', 'điểm cuối cùng của mỗi phút'], a: 1, why: 'avg của avg sai khi số điểm mỗi nhóm khác nhau; sum và count gộp được, min và max giữ đỉnh.' },
    { t: 'mc', q: 'Ưu điểm nổi bật của mô hình pull so với push trong giám sát hạ tầng tự quản?', o: ['Không cần service discovery', 'Hợp với job ngắn hạn như Lambda', 'Biết ngay target chết vì scrape thất bại là một tín hiệu', 'Không cần mở cổng trên host'], a: 2, why: 'Với push, host chết chỉ thể hiện bằng sự im lặng, phải suy luận; pull có tín hiệu up=0 rõ ràng.' },
    { t: 'mc', q: 'Một cron job ngừng chạy hoàn toàn nhưng không ném lỗi nào. Loại alert nào bắt được?', o: ['Alert error_rate > 5%', 'Alert latency p99 > 1 s', 'Alert CPU > 90%', 'Alert absent hoặc counter thành công không tăng trong N phút'], a: 3, why: 'Không có lỗi thì các alert dựa trên lỗi đều im; chỉ alert trên sự vắng mặt mới thấy.' },
    { t: 'mc', q: 'Vì sao đặt Kafka giữa collector và TSDB?', o: ['Để giảm độ trễ ghi', 'Để nén dữ liệu tốt hơn', 'Để chịu burst, cho TSDB bảo trì không mất điểm và có thể replay', 'Để thay thế inverted index'], a: 2, why: 'Kafka là buffer bền, tách tốc độ ghi khỏi tốc độ xử lý; đổi lại thêm vài trăm ms.' },
    { t: 'fill', q: 'Điền: kỹ thuật nén time series bằng delta-of-delta cho timestamp và XOR cho value, đạt khoảng 1,4 byte mỗi điểm, có tên là ___ encoding.', a: ['gorilla', 'gorilla encoding'], why: 'Từ bài báo Gorilla của Facebook, Prometheus và nhiều TSDB dùng biến thể này.' },
    { t: 'fill', q: 'Điền: trong alert rule, mệnh đề ___ 10m yêu cầu điều kiện đúng liên tục 10 phút mới chuyển sang firing, tránh flapping.', a: ['for'], why: 'for-duration giữ alert ở pending trước khi firing.' },
    { t: 'open', q: 'Người phỏng vấn hỏi: alert manager của bạn chết thì ai báo? Trình bày thiết kế để hệ giám sát tự giám sát.', a: 'Chạy alert manager nhiều instance với state persist để restart không mất alert đang firing và không gửi lại. Thêm dead man switch: một rule luôn đúng tạo alert firing liên tục gửi tới dịch vụ heartbeat bên ngoài hệ thống; nếu dịch vụ đó không nhận được trong N phút thì nó gọi người trực. Thêm metric cho chính pipeline: scrape thành công, lag consumer Kafka, số rule đánh giá mỗi chu kỳ, và alert absent trên các metric này. Dashboard health của hệ monitoring tách riêng khỏi dashboard sản phẩm.', keys: ['dead man', 'persist', 'absent', 'heartbeat', 'instance'] }
  ]
},
{ id: 'C13', type: 'case', topic: 'data', title: 'Case: Design an ad click event aggregation system', time: '120 phút',
  goal: 'Thiết kế được pipeline Kafka → Flink window 1 phút → OLAP với exactly-once hiệu quả bằng dedup + idempotent write, xử lý late event bằng watermark, và giữ raw data để reconcile; so sánh lambda và kappa.',
  md: `
## Đề bài
> "Design a real-time analytics system that aggregates ad click events: for each ad, count clicks per minute, return the top 100 most clicked ads in the last M minutes, and support filtering by attributes such as country. The numbers are used for billing, so they must be correct."

Dịch: Thiết kế hệ thống phân tích real-time gộp sự kiện click quảng cáo: đếm click theo từng ad mỗi phút, trả top 100 ad được click nhiều nhất trong M phút gần nhất, lọc theo thuộc tính như quốc gia. Số liệu dùng để tính tiền nên phải đúng. Thời gian 45 phút.

## 1. Làm rõ yêu cầu (5 phút)
- Hỏi: Lượng click? → Đáp: 1 tỷ click/ngày, 2 triệu ad đang chạy.
- Hỏi: Độ trễ từ click đến khi thấy số? → Đáp: vài phút là được; không cần dưới giây.
- Hỏi: Sự kiện có thể đến muộn hoặc trùng? → Đáp: có, client retry và mạng di động; đến muộn vài phút là bình thường.
- Hỏi: Đúng tuyệt đối ngay lập tức, hay đúng cuối cùng (eventually)? → Đáp: real-time có thể sai nhỏ, nhưng số dùng billing cuối ngày phải đúng.
- Hỏi: Truy vấn lịch sử bao xa? → Đáp: top-N và count theo phút trong 30 ngày; raw lưu 1 năm.
- Hỏi: Thuộc tính lọc bao nhiêu? → Đáp: vài cái: country, device, ip (ip chỉ để dedup).

Chốt lại:
- **Functional**: đếm click theo (ad_id, phút); top-100 ad theo M phút; lọc theo country và device; truy vấn lịch sử 30 ngày.
- **Non-functional**: xử lý 10k đến 50k sự kiện/giây; độ trễ end-to-end dưới 5 phút; **đúng cuối cùng** cho billing, tức có cơ chế sửa số; không mất raw event.
- **Ngoài phạm vi**: phát hiện gian lận click (chỉ để chỗ cắm), phân phối quảng cáo.

## 2. Ước lượng (5 phút)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Sự kiện/giây trung bình | 10^9 / 10^5 s | ~10 000/s |
| Đỉnh | ×5 | ~50 000/s |
| Kích thước 1 event | event_id 16 B, ad_id 8 B, ts 8 B, user_id 8 B, ip 16 B, country, device ~40 B | ~100 B |
| Raw mỗi ngày | 10^9 × 100 B | ~100 GB/ngày, ~36 TB/năm chưa nén, ~10 TB nén parquet |
| Kết quả gộp mỗi ngày | 2 triệu ad × 1 440 phút × tỉ lệ ad có click mỗi phút ~10% | ~290 triệu dòng/ngày × ~40 B ≈ 12 GB/ngày |
| State trong Flink | 2 triệu ad × vài cửa sổ đang mở × ~50 B | vài trăm MB, RocksDB chịu tốt |
| Dedup state | 50k/s × cửa sổ 10 phút × 16 B | 480 MB cho id trong 10 phút |

Kết luận: raw 100 GB/ngày là bình thường cho Kafka và S3; cái khó là **đúng** khi có trùng và đến muộn, và truy vấn top-N nhanh.

## 3. Thiết kế tổng thể (10–12 phút)
:::diagram
Client[Ad SDK / browser] -> LogSvc[Click log service] : POST click
LogSvc -> Kafka[Kafka topic clicks] : key = ad_id
Kafka -> Flink[Flink aggregation 1 phút] : watermark + dedup
Kafka -> Raw[S3 raw parquet] : connector sink
Flink -> Out[Kafka topic agg_results]
Out -> Writer[Idempotent writer]
Writer -> OLAP[OLAP store ClickHouse]
Query[Query service] -> OLAP
Dash[Dashboard / Billing] -> Query
Recon[Batch recompute Spark] -> Raw
Recon -> OLAP : ghi đè theo phút
:::

**Luồng ghi**: SDK gửi click kèm [[event_id]] (UUID sinh tại client) tới log service; log service validate nhẹ, append vào Kafka với key ad_id để cùng ad về cùng partition. Flink đọc, dedup theo event_id trong cửa sổ 10 phút, gộp theo tumbling window 1 phút (ad_id, country, device), phát kết quả khi watermark vượt cuối cửa sổ; kết quả ghi Kafka rồi writer **upsert** vào OLAP theo key (ad_id, minute, country, device). Raw event đồng thời đổ xuống S3 theo giờ. **Luồng đọc**: Query service hỏi OLAP: count theo phút, top-N bằng ORDER BY sum(count) DESC LIMIT 100 trên khoảng M phút.

| Endpoint | Mô tả | Ghi chú |
|---|---|---|
| POST /v1/clicks | Ghi nhận click | body có event_id, trả 202 |
| GET /v1/ads/{id}/clicks?from&to&granularity=minute | Count theo phút của một ad | lọc country, device |
| GET /v1/ads/top?window=5m&country=JP | Top-100 ad | ORDER BY trên OLAP |
| GET /v1/reports/daily?date= | Số billing đã reconcile | chỉ đọc sau khi batch chạy |

Mô hình dữ liệu:
| Bảng | Key | Ghi chú |
|---|---|---|
| clicks_raw (S3 parquet) | partition theo ngày/giờ | event_id, ad_id, ts, user_id, ip, country, device; nguồn sự thật |
| clicks_minute (OLAP) | (ad_id, minute, country, device) | count, version, updated_at; upsert được |
| clicks_minute_total (OLAP) | (ad_id, minute) | tổng mọi thuộc tính, phục vụ top-N nhanh |
| recon_run | (date) | trạng thái batch, số dòng sửa |

## 4. Đào sâu (15–18 phút)
### 4.1 Exactly-once: Flink checkpoint không đủ, cần idempotent sink
Vấn đề: "exactly-once" của Flink chỉ bảo đảm **state nội bộ** mỗi event được tính đúng một lần sau khi khôi phục từ checkpoint. Khi ghi ra ngoài, nếu sink không transactional thì sau crash vẫn ghi đúp.
| Phương án | Cách làm | Nhược |
|---|---|---|
| At-least-once + đếm thẳng | Flink restart thì tính lại từ offset cũ | Đếm đúp sau mỗi lần crash |
| Two-phase commit sink | Sink tham gia checkpoint, commit theo checkpoint | Sink phải hỗ trợ transaction, độ trễ bằng chu kỳ checkpoint |
| Idempotent upsert theo key cửa sổ | Kết quả cửa sổ là giá trị tuyệt đối, ghi đè theo (ad_id, minute, ...) | Chỉ hoạt động khi output là **giá trị cửa sổ**, không phải delta |

Chọn phương án 3 kết hợp dedup đầu vào: dedup theo event_id trong state Flink (TTL 10 phút) để client retry không bị đếm 2 lần; output của cửa sổ là tổng tuyệt đối nên ghi lại bao nhiêu lần cũng ra cùng số. Đây là cách rẻ nhất để có **effectively-once**.

### 4.2 Late event và watermark
Event có [[event_time]] (lúc click) khác [[processing_time]] (lúc Flink thấy). Cửa sổ 1 phút theo event_time: khi nào dám chốt?
- **Watermark** = mốc "tin rằng mọi event trước mốc này đã tới", ví dụ max(event_time) − 15 giây. Cửa sổ chốt khi watermark vượt cuối cửa sổ.
- **Allowed lateness** 2 phút: event đến sau watermark nhưng trong 2 phút vẫn cập nhật cửa sổ và phát lại kết quả (upsert ghi đè, nhờ 4.1).
- Quá 2 phút → **side output** đổ vào topic late_events; batch cuối ngày cộng lại từ raw.
| Watermark | Độ trễ kết quả | Độ đúng real-time |
|---|---|---|
| 5 giây | Nhanh | Bỏ sót nhiều event di động |
| 15 giây + lateness 2 phút | Vừa | Bắt được đa số; phần còn lại nhờ batch |
| 5 phút | Chậm | Gần đúng nhưng dashboard lạc hậu |

### 4.3 Lambda hay kappa, và raw data để làm gì
| Kiến trúc | Mô tả | Ưu | Nhược |
|---|---|---|---|
| Lambda | Stream cho số nhanh + batch cho số đúng, hai code path | Số billing chắc chắn đúng từ raw | Hai logic phải khớp, tốn công bảo trì |
| Kappa | Chỉ stream; sửa số bằng replay Kafka từ offset cũ | Một code path | Replay 1 ngày là 1 tỷ event, retention Kafka phải dài |
| Kappa + raw trên S3 | Stream là chính, batch recompute **cùng logic** (Flink batch mode) từ raw khi cần | Một logic, hai chế độ chạy | Vẫn cần hạ tầng batch |

Chọn phương án 3: raw trên S3 là nguồn sự thật, không bao giờ xoá trong 1 năm. Batch hằng đêm tính lại ngày hôm trước, ghi đè OLAP theo phút; chênh lệch so với stream ghi vào recon_run. Số billing lấy từ kết quả đã reconcile. Người phỏng vấn muốn nghe câu: **stream phục vụ nhìn, batch phục vụ tiền**.

### 4.4 Truy vấn top-N và lọc thuộc tính
Top-100 trong M phút = gộp M dòng mỗi ad rồi sort 2 triệu ad: với M = 60 là 120 triệu dòng, OLAP cột như ClickHouse quét trong dưới 1 giây; với dashboard refresh liên tục thì pre-aggregate theo cửa sổ 5 phút và cache top-N mỗi phút. Lọc theo country và device: pre-aggregate theo tổ hợp (ad_id, minute, country, device) có ~2 triệu × 200 nước × 3 device trong lý thuyết nhưng thực tế thưa, chỉ dòng có click mới tồn tại; lọc theo ip không hỗ trợ vì cardinality vô hạn, ip chỉ dùng dedup và chống gian lận.

## 5. Trade-off & câu hỏi vặn (5 phút)
- *Why partition Kafka by ad_id?* → Để mọi click của một ad vào cùng partition và cùng Flink task, gộp không cần shuffle; rủi ro hot key với ad siêu lớn thì thêm salt rồi gộp lần hai.
- *What happens if Flink is down for an hour?* → Kafka giữ event; khi lên, Flink đọc từ checkpoint offset, watermark tiến nhanh, kết quả upsert ghi đè; dashboard trễ 1 giờ rồi bắt kịp.
- *Why not count directly in the OLAP database?* → 50k insert/s dòng raw vào OLAP được nhưng query top-N phải gộp 1 tỷ dòng; pre-aggregate theo phút giảm 1 000 lần.
- *How do you dedupe without unbounded state?* → State TTL 10 phút theo event_id; trùng xa hơn nhờ batch dedup trên raw.
- *How late is too late?* → Chọn theo dữ liệu thật: đo phân phối event_time trừ processing_time, lấy p99 làm allowed lateness.
- *Billing team says numbers changed after midnight, is that a bug?* → Không, đó là thiết kế: real-time là ước lượng, số cuối ngày là sau reconcile; tài liệu hoá và hiển thị trạng thái "final" trên report.
- *Could you do this with Spark Structured Streaming instead of Flink?* → Được, micro-batch trễ hơn vài giây và watermark tương tự; chọn theo đội ngũ quen gì.
- *Hot ad with 20% of all clicks?* → Hai tầng gộp: gộp theo (ad_id, salt 0–9) trước, rồi gộp theo ad_id.

## 6. Người phỏng vấn chấm gì
| Tiêu chí | Câu trả lời yếu | Câu trả lời mạnh |
|---|---|---|
| Correctness | "Dùng Flink exactly-once là xong" | Phân biệt exactly-once state và sink; dedup + idempotent upsert |
| Thời gian | Không phân biệt event time và processing time | Watermark, allowed lateness, side output, số cụ thể |
| Kiến trúc dữ liệu | Chỉ stream hoặc chỉ batch | Raw bất biến trên S3, stream để nhìn, batch để tính tiền |
| Truy vấn | Scan raw để lấy top-N | Pre-aggregate theo phút, OLAP cột, cache top-N |
| Vận hành | Không nói | Hot key salt, state TTL, lag consumer, recon mismatch metric |

**Nói thế nào trong phỏng vấn (EN)**
- "Exactly-once inside Flink does not make the output exactly-once; I make the sink idempotent by writing absolute window values." — Exactly-once trong Flink không làm output exactly-once; sink phải idempotent.
- "I will separate event time from processing time and choose a watermark of fifteen seconds with two minutes of allowed lateness." — Tách event time và processing time, watermark 15 giây, lateness 2 phút.
- "Raw events on S3 are the source of truth; streaming serves dashboards, the nightly batch serves billing." — Raw trên S3 là sự thật; stream cho dashboard, batch cho billing.
- "Partitioning by ad id keeps the aggregation local, and I would salt hot keys." — Partition theo ad id để gộp cục bộ, salt cho key nóng.
- "Late data is a product decision as much as a technical one, so I would show a final flag on reports." — Dữ liệu muộn là quyết định sản phẩm, hiển thị cờ final trên report.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Pipeline enrichment của SBOM là một stream job trá hình: event = component cần enrich, output = trạng thái và license. Bài học idempotent upsert áp thẳng: kết quả ghi theo key (tenant, purl, revision) với giá trị tuyệt đối, ghi lại bao nhiêu lần cũng ra cùng số, nên sweeper và inline không còn "map 2 lần" khác nhau.
- "Raw là sự thật, aggregate là dẫn xuất" soi vào sự cố #14: violation là dẫn xuất của (component, policy); mất thì tính lại từ raw, không được để lần eval lỗi xoá kết quả tốt. Giữ raw kết quả eval theo run_id như clicks_raw.
- Dashboard Vulnerability distribution (ticket 3214 trong memory) đọc snapshot t_project_metrics chạy one-shot; áp mô hình lambda: snapshot nhanh sau upload, batch recompute hằng đêm ghi đè để số cuối cùng luôn đúng.
- Late event tương đương vulnerability feed sync kết thúc giữa chừng reconcile (ticket 3362): cần "watermark" = finished_at của feed, và allowed lateness thay vì bỏ qua.
- Hot key: tenant có target 200k component (sự cố #16) chính là hot ad; chia batch theo salt để không nghẽn một worker.
- Dedup theo event_id soi vào RabbitMQ redelivery: message import được gửi lại sau khi worker chết phải idempotent theo import_id, consumer kiểm tra trạng thái trước khi parse lại.
- Partition theo key: queue enrichment chia theo hash(coordinate) để cùng coordinate không bị hai worker gọi API ngoài cùng lúc, giống click cùng ad_id về cùng partition.
- Việc tuần này: thêm cột run_id và upsert theo key tự nhiên cho bảng metric; viết job recompute hằng đêm cho 1 tenant thử nghiệm và so lệch với snapshot.
`,
  quiz: [
    { t: 'mc', q: 'Flink bật exactly-once checkpoint nhưng sau crash OLAP vẫn bị đếm đúp. Giải thích hợp lý nhất?', o: ['Checkpoint interval quá dài', 'Exactly-once chỉ áp dụng cho state nội bộ; sink không transactional hoặc không idempotent', 'Kafka partition không đủ', 'Watermark đặt quá ngắn'], a: 1, why: 'Output ra hệ ngoài cần two-phase commit sink hoặc idempotent upsert; checkpoint không tự làm điều đó.' },
    { t: 'mc', q: 'Event click đến sau khi watermark đã vượt cuối cửa sổ 1 phút nhưng vẫn trong allowed lateness. Hệ thống nên?', o: ['Bỏ event vì cửa sổ đã đóng', 'Cộng vào cửa sổ hiện tại (phút đang chạy)', 'Cập nhật cửa sổ cũ và phát lại kết quả, writer upsert ghi đè', 'Ghi thẳng vào OLAP không qua Flink'], a: 2, why: 'Allowed lateness giữ state cửa sổ cũ để cập nhật; nhờ upsert nên phát lại không gây đếm đúp.' },
    { t: 'mc', q: 'Vì sao giữ raw event trên S3 dù đã có kết quả gộp theo phút?', o: ['Để OLAP đọc trực tiếp khi query', 'Để tính lại và reconcile số billing khi stream sai hoặc đổi logic', 'Vì Kafka không lưu được quá 1 ngày', 'Để giảm chi phí OLAP'], a: 1, why: 'Raw bất biến là nguồn sự thật; mọi dẫn xuất có thể tính lại từ đó.' },
    { t: 'mc', q: 'Một ad chiếm 20% tổng click làm một Flink task quá tải. Cách xử lý chuẩn?', o: ['Tăng số partition Kafka', 'Giảm watermark', 'Chuyển ad đó sang xử lý batch', 'Gộp hai tầng: theo (ad_id, salt) trước rồi gộp theo ad_id'], a: 3, why: 'Salt chia hot key ra nhiều task, tầng hai cộng lại; tăng partition không giúp vì cùng key vẫn về một partition.' },
    { t: 'mc', q: 'Dedup theo event_id trong Flink dùng state có TTL 10 phút. Trùng lặp đến sau 10 phút được xử lý bằng gì?', o: ['Batch dedup trên raw S3 khi recompute hằng đêm', 'Không xử lý, chấp nhận sai', 'Tăng TTL lên 1 năm', 'OLAP tự dedup'], a: 0, why: 'State stream phải hữu hạn; phần đuôi hiếm giao cho batch từ raw.' },
    { t: 'fill', q: 'Điền: mốc thời gian mà stream processor tin rằng mọi event có event_time nhỏ hơn nó đã tới, dùng để quyết định đóng cửa sổ, gọi là ___.', a: ['watermark'], why: 'Watermark cân bằng giữa độ trễ kết quả và độ đầy đủ của dữ liệu.' },
    { t: 'fill', q: 'Điền: kiến trúc chỉ dùng một đường stream và sửa số bằng cách replay log, đối lập với lambda, gọi là kiến trúc ___.', a: ['kappa'], why: 'Kappa giảm một code path nhưng đòi hỏi replay log dài.' },
    { t: 'open', q: 'Billing team phàn nàn số click của ngày hôm qua thay đổi sau nửa đêm. Giải thích vì sao và cách bạn thiết kế để điều này không gây tranh cãi.', a: 'Số real-time là ước lượng từ stream với watermark và allowed lateness hữu hạn; event rất muộn và trùng lặp ngoài TTL chỉ được xử lý bởi batch recompute hằng đêm từ raw trên S3, nên số cuối cùng khác số tạm. Thiết kế: raw là nguồn sự thật, OLAP có cột trạng thái provisional hoặc final theo ngày, report billing chỉ đọc final, dashboard hiển thị cờ. Khi reconcile, ghi mismatch giữa stream và batch vào recon_run để theo dõi độ lệch, nếu lệch lớn thì điều chỉnh watermark. Tài liệu hoá SLA: số final sau 02:00 sáng hôm sau.', keys: ['watermark', 'batch', 'raw', 'final', 'reconcile'] }
  ]
},
{ id: 'C14', type: 'case', topic: 'search', title: 'Case: Design a proximity service (Yelp nearby search)', time: '120 phút',
  goal: 'Thiết kế được dịch vụ tìm địa điểm gần đây với geohash (so sánh quadtree, S2), tách business service khỏi location service đọc nhiều, cache theo ô geohash, và mở rộng sang nearby friends với WebSocket + Redis pub/sub.',
  md: `
## Đề bài
> "Design a proximity service like Yelp nearby search: given the user location and a radius, return nearby businesses. Business owners can add, update, or delete their listings. Assume 100 million daily active users and 200 million businesses."

Dịch: Thiết kế dịch vụ tìm kiếm lân cận như Yelp: từ vị trí người dùng và bán kính, trả danh sách doanh nghiệp gần đó. Chủ doanh nghiệp thêm, sửa, xoá listing. Giả định 100 triệu người dùng hằng ngày, 200 triệu doanh nghiệp. Thời gian 45 phút.

## 1. Làm rõ yêu cầu (5 phút)
- Hỏi: Bán kính tối đa? → Đáp: 0,5 km đến 20 km, người dùng chọn.
- Hỏi: Kết quả cần sắp xếp theo khoảng cách hay rating? → Đáp: theo khoảng cách, rating để sau.
- Hỏi: Listing thêm mới bao lâu phải thấy trong tìm kiếm? → Đáp: trong ngày là được, không cần real-time.
- Hỏi: Có cần kết quả theo thời gian thực của người dùng di chuyển (nearby friends)? → Đáp: câu hỏi mở rộng cuối giờ nếu còn thời gian.
- Hỏi: Số kết quả mỗi lần? → Đáp: tối đa 20, có phân trang.
- Hỏi: Toàn cầu? → Đáp: có, nhiều region.

Chốt lại:
- **Functional**: tìm doanh nghiệp theo (lat, lng, radius) trả tối đa 20 kết quả theo khoảng cách; xem chi tiết doanh nghiệp; chủ doanh nghiệp CRUD listing.
- **Non-functional**: đọc rất nhiều, ghi rất ít; độ trễ tìm kiếm p99 dưới 200 ms; sẵn sàng cao; dữ liệu listing eventual consistency trong vài phút là chấp nhận được.
- **Ngoài phạm vi**: review, ảnh, xếp hạng theo độ phù hợp, bản đồ render.

## 2. Ước lượng (5 phút)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Tìm kiếm/ngày | 100 triệu DAU × 5 lần | 5 × 10^8 |
| QPS tìm kiếm trung bình | 5 × 10^8 / 10^5 s | ~5 000 QPS |
| QPS đỉnh | ×3 | ~15 000 QPS |
| Ghi listing | 200 triệu listing, 1% cập nhật mỗi ngày | ~2 triệu/ngày, ~25/s |
| Lưu business | 200 triệu × ~1 KB | ~200 GB |
| Geo index | 200 triệu × (geohash 6 ký tự ~8 B + business_id 8 B) | ~3,2 GB, vừa RAM một máy |
| Cache kết quả | 5 000 QPS, hit 90% | TTL vài giờ, vài chục GB cho ô geohash nóng |

Kết luận: ghi không đáng kể, index geo vừa RAM, bài này là **đọc nhiều và chọn đúng cấu trúc chỉ mục không gian**.

## 3. Thiết kế tổng thể (10–12 phút)
:::diagram
Client[Mobile / Web] -> LB[Load balancer]
LB -> LBS[Location-based service stateless]
LB -> BizSvc[Business service CRUD]
LBS -> GeoIdx[Geo index Redis hoặc Postgres replica] : WHERE geohash IN 9 ô
LBS -> Cache[Redis cache theo geohash]
LBS -> BizRep[Business DB read replica] : lấy chi tiết theo id
BizSvc -> BizDB[Business DB primary]
BizDB -> BizRep : async replication
BizDB -> GeoIdx : CDC hoặc job cập nhật index
:::

**Luồng đọc**: client gửi lat, lng, radius → LBS tính độ dài geohash theo radius, tính ô geohash của người dùng và 8 ô lân cận → tra cache theo ô; miss thì hỏi geo index [[SELECT business_id FROM geo_index WHERE geohash IN (9 ô)]] → lấy chi tiết từ replica theo id → tính khoảng cách thật (haversine), lọc theo radius, sort, lấy 20. **Luồng ghi**: chủ doanh nghiệp gọi Business service ghi vào primary; index geohash cập nhật cùng transaction (nếu chung DB) hoặc qua job hằng đêm vì yêu cầu chỉ cần "trong ngày".

| Endpoint | Mô tả | Ghi chú |
|---|---|---|
| GET /v1/search/nearby?lat&lng&radius&page | Tìm lân cận | trả id, tên, khoảng cách |
| GET /v1/businesses/{id} | Chi tiết doanh nghiệp | cache được lâu |
| POST /v1/businesses | Tạo listing | tính geohash lúc ghi |
| PUT /v1/businesses/{id} | Cập nhật | đổi toạ độ thì cập nhật geohash |
| DELETE /v1/businesses/{id} | Xoá | xoá mềm, index xoá theo |

Mô hình dữ liệu:
| Bảng | Key | Ghi chú |
|---|---|---|
| business | business_id | name, address, lat, lng, category, geohash6, updated_at |
| geo_index | (geohash, business_id) composite | index B-tree trên geohash, truy vấn prefix và IN |
| cache nearby | key = geohash ô 5 hoặc 6 ký tự | value = danh sách business_id, TTL 1 giờ |

Độ chính xác geohash cần nhớ:
| Độ dài | Kích thước ô xấp xỉ | Dùng cho bán kính |
|---|---|---|
| 4 | 39 km × 20 km | 20 km trở lên |
| 5 | 4,9 km × 4,9 km | 2 đến 5 km |
| 6 | 1,2 km × 0,6 km | 0,5 đến 1 km |
| 7 | 153 m × 153 m | dưới 500 m |

## 4. Đào sâu (15–18 phút)
### 4.1 Geohash, quadtree hay S2?
| Tiêu chí | Geohash | Quadtree | Google S2 |
|---|---|---|---|
| Ý tưởng | Chia lưới cố định, mã hoá thành chuỗi base32 | Cây 4 nhánh chia đến khi mỗi lá dưới N điểm | Chiếu cầu lên 6 mặt lập phương, Hilbert curve |
| Lưu ở đâu | Cột trong DB bất kỳ, Redis GEO | Trong RAM của mỗi server | Thư viện, cell id 64 bit trong DB |
| Mật độ không đều | Ô cố định: Tokyo đông, sa mạc trống | Tự thích nghi theo mật độ | Tốt, nhiều cấp |
| Vấn đề biên | Hai điểm sát nhau khác ô, phải lấy 8 ô lân cận | Tương tự, duyệt node kề | Phủ vùng bằng tập cell chính xác hơn |
| Cập nhật | Chỉ sửa một dòng | Phải rebuild cây hoặc sửa tại chỗ phức tạp | Sửa một dòng |
| Vận hành | Đơn giản nhất | Phải load 200 triệu điểm vào RAM mỗi server khi khởi động | Khó hiểu hơn, ít người quen |

Chọn geohash vì dùng được cấu trúc có sẵn (Postgres B-tree, Redis GEO dùng geohash 52 bit bên trong) và cập nhật là một dòng. Quadtree hợp khi cần thích nghi mật độ và chấp nhận rebuild; S2 khi cần phủ vùng hình dạng phức tạp (Google Maps, Uber dùng H3 tương tự).

### 4.2 Vấn đề biên và chọn độ dài geohash
Người dùng đứng sát mép ô: quán cách 50 m nhưng nằm ô bên cạnh. Giải pháp: luôn truy vấn ô của người dùng **và 8 ô xung quanh** (tổng 9 ô), rồi lọc lại bằng khoảng cách thật. Với radius 1 km dùng geohash 6 (ô 1,2 km): 9 ô phủ 3,6 km × 1,8 km, chắc chắn chứa hình tròn bán kính 1 km. Nếu kết quả ít hơn 20, mở rộng bằng cách **bỏ 1 ký tự** (lên cấp 5) và truy vấn lại. Index [[(geohash, business_id)]] trả lời IN 9 giá trị bằng 9 lần tìm B-tree, dưới 1 ms khi vừa RAM.

### 4.3 Tách Location-based service khỏi Business service, cache và replica
- LBS là đường nóng 15k QPS, stateless, scale ngang; chỉ đọc. Business service xử lý 25 ghi/s và các thao tác quản trị; sự cố ở một bên không kéo bên kia.
- Replica: geo index và chi tiết doanh nghiệp đọc từ read replica; lag vài giây không ảnh hưởng vì yêu cầu "thấy trong ngày".
- Cache theo **ô geohash** chứ không theo (lat, lng, radius): hàng triệu toạ độ khác nhau quy về vài triệu ô, hit rate cao. Key [[geohash:6:xn76ur]] → danh sách id. Khi listing đổi toạ độ thì invalidate 2 ô (cũ, mới), hoặc chấp nhận TTL 1 giờ.
- Multi-region: mỗi region chạy đủ LBS + replica + cache, dữ liệu replicate toàn cục; người dùng Nhật truy vấn ô ở Nhật, không cần cross-region.
| Phương án cache | Hit rate | Nhược |
|---|---|---|
| Theo (lat, lng, radius) chính xác | Rất thấp | Mỗi người một key |
| Theo ô geohash + radius bucket | Cao | Phải tính 9 key mỗi lần, nhỏ |
| Cache chi tiết business theo id | Cao | Chỉ giúp bước 2 |

### 4.4 Mở rộng: nearby friends (vị trí thay đổi liên tục)
Khác biệt: vị trí cập nhật mỗi 30 giây từ hàng triệu người, và cần đẩy về client gần real-time.
:::diagram
App[Mobile app] -> WS[WebSocket server] : vị trí mỗi 30 s
WS -> LocCache[Redis location cache TTL 10 phút]
WS -> PubSub[Redis pub/sub kênh theo user_id] : publish vị trí
PubSub -> WS : subscribe kênh của bạn bè
WS -> App : đẩy vị trí bạn bè trong 5 km
WS -> LocHist[Location history DB Cassandra] : ghi lịch sử
:::
Mỗi người có kênh pub/sub riêng; khi A kết nối, WS server của A subscribe kênh của tất cả bạn bè A (trung bình 400). Khi B gửi vị trí, WS của B publish lên kênh B; mọi server có người đang theo dõi B nhận được, tính khoảng cách tới từng người theo dõi, chỉ đẩy nếu dưới 5 km. Location cache có TTL 10 phút để người tắt app tự biến mất. Với 10 triệu người online, 30 giây một lần là ~330k publish/s, mỗi publish fan-out tới ~400 subscriber, tức ~130 triệu message/s qua pub/sub, cần shard Redis pub/sub theo user_id trên hàng chục node. Ô geohash dùng cho người lạ gần nhau (random nearby), còn bạn bè dùng pub/sub vì danh sách nhỏ và cố định.

## 5. Trade-off & câu hỏi vặn (5 phút)
- *Why not PostGIS or Elasticsearch geo queries?* → Hoàn toàn được; PostGIS dùng GiST index tương đương, Elasticsearch dùng BKD tree. Geohash tay cho thấy mình hiểu bản chất, còn production chọn thứ đội ngũ vận hành tốt.
- *How do you handle a dense area like Shinjuku returning thousands of results?* → Tăng độ dài geohash (ô nhỏ hơn), phân trang theo khoảng cách, giới hạn 20 và cho lọc theo category.
- *Business moved 2 km, when does search reflect it?* → Index cập nhật cùng transaction ghi hoặc job hằng đêm; cache TTL 1 giờ; nói rõ eventual consistency là chấp nhận được theo yêu cầu.
- *Can a single Redis hold the geo index?* → 3,2 GB thì được; để sẵn sàng cao dùng replica và cluster theo slot của geohash prefix.
- *Why 9 cells and not the exact circle?* → 9 ô đơn giản, 9 lần tìm B-tree; phủ chính xác hơn bằng S2 covering khi cần, nhưng hiếm khi đáng.
- *Distance calculation cost?* → Haversine vài trăm ns, 9 ô × vài trăm điểm = vài chục µs, không đáng kể.
- *Ranking by rating and distance?* → Lấy ứng viên trong 9 ô, chấm điểm tổng hợp trong LBS; cần thêm cột rating vào bảng geo_index để tránh tra chi tiết.
- *How would nearby friends scale past Redis pub/sub?* → Chuyển sang Kafka theo partition user hoặc shard pub/sub theo user_id trên nhiều cụm, hoặc gộp vị trí theo ô geohash cho người có quá nhiều bạn.

## 6. Người phỏng vấn chấm gì
| Tiêu chí | Câu trả lời yếu | Câu trả lời mạnh |
|---|---|---|
| Chỉ mục không gian | "Query lat, lng trong khoảng" bằng hai BETWEEN | Giải thích geohash, vấn đề biên, 9 ô, so sánh quadtree và S2 |
| Ước lượng | Bỏ qua | 5k QPS đọc, 25 ghi/s, index 3,2 GB vừa RAM |
| Kiến trúc | Một service làm tất cả | Tách LBS đọc nhiều khỏi Business service, replica, cache theo ô |
| Mở rộng | Không có | Nearby friends: WebSocket, pub/sub, TTL, fan-out số liệu |
| Trade-off | Chọn công cụ theo tên | Nói rõ khi nào geohash thua quadtree hay S2 |

**Nói thế nào trong phỏng vấn (EN)**
- "This is a read-heavy problem with a tiny write path, so I will optimize the spatial index and cache aggressively." — Bài đọc nhiều ghi ít, tối ưu index không gian và cache.
- "I would encode locations as geohashes and query the user cell plus its eight neighbors to avoid boundary misses." — Mã hoá geohash, truy vấn ô người dùng và 8 ô lân cận.
- "Geohash fits in any B-tree; a quadtree adapts to density but must live in memory and be rebuilt." — Geohash nằm trong B-tree bất kỳ; quadtree thích nghi mật độ nhưng phải ở RAM.
- "Caching by cell rather than by exact coordinates turns millions of distinct requests into a few million keys." — Cache theo ô biến hàng triệu request khác nhau thành vài triệu key.
- "For nearby friends I would switch to WebSockets and per-user pub/sub channels with a short TTL on locations." — Nearby friends dùng WebSocket và kênh pub/sub theo người, TTL ngắn.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Không có toạ độ, nhưng tư duy "chọn key cache theo ô thay vì theo request" áp thẳng: cache enrichment theo **coordinate chuẩn hoá** (purl không version-range) thay vì theo chuỗi gốc; Redis L1 trong Lambda (ticket 2117) hit cao hơn khi key được chuẩn hoá.
- Tách đường nóng đọc khỏi đường ghi: trang Components và Portfolio đọc nhiều nên đi read replica Aurora, còn import và enrichment ghi vào primary; điều này giảm tác động của upload 200k component lên người đang xem.
- "9 ô lân cận" là bài học về fuzzy match: tra vulnerability theo version chính xác thì bỏ sót, cần tra theo range lân cận rồi lọc lại bằng so sánh version thật (như haversine lọc sau geohash).
- Nearby friends với TTL 10 phút gợi ý cho trạng thái "worker đang sống": heartbeat key có TTL trong Redis, mất heartbeat là biết worker chết, tránh sự cố cron im lặng.
- Phân trang theo khoảng cách gợi ý Components list dùng keyset pagination theo (name, id) thay OFFSET (sự cố #11): mỗi trang là một range scan, không quét lại từ đầu.
- Mở rộng ô khi thiếu kết quả tương đương fallback tra license: tra purl đầy đủ, không có thì tra theo namespace và name bỏ version, không có nữa thì no_locator; mỗi bước rộng hơn và ghi độ tin cậy.
- Multi-region phục vụ người dùng từ node gần nhất tương đương FE server-side gọi API qua địa chỉ nội bộ (sự cố #10 hairpin NAT): đường ngắn nhất trong cùng mạng, không vòng ra public.
- Việc tuần này: đo tỉ lệ hit cache enrichment theo kiểu key hiện tại; thử chuẩn hoá key và đo lại trên 1 tenant.
`,
  quiz: [
    { t: 'mc', q: 'Người dùng đứng sát mép ô geohash, quán ăn cách 50 m nhưng thuộc ô bên cạnh. Cách xử lý chuẩn?', o: ['Tăng độ dài geohash để ô nhỏ hơn', 'Truy vấn ô của người dùng và 8 ô lân cận rồi lọc theo khoảng cách thật', 'Chuyển sang lưu lat, lng và dùng BETWEEN', 'Dùng bán kính lớn gấp đôi'], a: 1, why: '9 ô phủ chắc chắn hình tròn bán kính nhỏ hơn cạnh ô; lọc lại bằng haversine để chính xác.' },
    { t: 'mc', q: 'Ưu điểm chính của quadtree so với geohash?', o: ['Dễ lưu trong Postgres hơn', 'Cập nhật một điểm chỉ sửa một dòng', 'Tự thích nghi mật độ: vùng đông chia nhỏ, vùng thưa giữ to', 'Không có vấn đề biên'], a: 2, why: 'Quadtree chia đến khi mỗi lá dưới N điểm; đổi lại phải nằm trong RAM và rebuild.' },
    { t: 'mc', q: 'Nên đặt key cache cho kết quả nearby theo gì để hit rate cao?', o: ['Theo ô geohash và bucket bán kính', 'Theo (lat, lng, radius) chính xác của request', 'Theo user_id', 'Theo timestamp phút'], a: 0, why: 'Toạ độ chính xác gần như không lặp lại; quy về ô geohash gom hàng nghìn request vào một key.' },
    { t: 'mc', q: 'Với bán kính tìm kiếm 1 km, độ dài geohash hợp lý nhất?', o: ['4 (ô ~39 km × 20 km)', '5 (ô ~4,9 km)', '8 (ô ~38 m)', '6 (ô ~1,2 km × 0,6 km)'], a: 3, why: 'Ô xấp xỉ bán kính; 9 ô cấp 6 phủ ~3,6 km × 1,8 km, đủ chứa hình tròn 1 km mà không quét quá rộng.' },
    { t: 'mc', q: 'Trong nearby friends, vì sao dùng Redis pub/sub theo kênh user_id thay vì truy vấn geohash mỗi 30 giây?', o: ['Pub/sub nén dữ liệu tốt hơn', 'Danh sách bạn bè nhỏ và cố định nên fan-out theo kênh rẻ hơn quét không gian; vị trí cập nhật liên tục', 'Geohash không hoạt động với người di chuyển', 'Redis không hỗ trợ truy vấn GEO'], a: 1, why: 'Bạn bè là tập con cố định; publish một lần tới ~400 subscriber rẻ hơn mỗi người quét 9 ô mỗi 30 giây.' },
    { t: 'fill', q: 'Điền: thư viện của Google chiếu mặt cầu lên 6 mặt lập phương và dùng đường cong Hilbert để đánh số ô gọi là ___.', a: ['s2', 'google s2', 's2 geometry'], why: 'S2 cell id 64 bit cho phép phủ vùng chính xác nhiều cấp.' },
    { t: 'fill', q: 'Điền: công thức tính khoảng cách giữa hai điểm trên mặt cầu theo kinh độ vĩ độ hay dùng để lọc lại kết quả gọi là công thức ___.', a: ['haversine'], why: 'Haversine tính vài trăm ns, dùng sau khi geohash đã thu hẹp ứng viên.' },
    { t: 'open', q: 'Người phỏng vấn yêu cầu mở rộng sang nearby friends với 10 triệu người online cập nhật vị trí mỗi 30 giây. Trình bày kiến trúc và ước lượng điểm nghẽn.', a: 'Client giữ WebSocket tới WS server; mỗi 30 giây gửi vị trí. Server ghi vào Redis location cache với TTL 10 phút và publish lên kênh pub/sub của user. Khi người dùng kết nối, server subscribe kênh của tất cả bạn bè (trung bình 400); nhận vị trí bạn thì tính khoảng cách và chỉ đẩy nếu dưới 5 km. Ước lượng: 10 triệu / 30 giây ≈ 330 nghìn publish mỗi giây, fan-out 400 cho ~130 triệu message mỗi giây qua pub/sub, nên phải shard Redis pub/sub theo user_id trên nhiều node; WS server 100 nghìn kết nối mỗi máy cần ~100 máy. Lịch sử vị trí ghi Cassandra nếu cần.', keys: ['websocket', 'pub/sub', 'ttl', 'fan-out', 'shard'] }
  ]
},
{ id: 'C15', type: 'case', topic: 'queue', title: 'Case: Design a distributed message queue (Kafka-like)', time: '120 phút',
  goal: 'Thiết kế được message queue phân tán với topic/partition, segment log append-only + index, replication leader/ISR, consumer group và offset, coordinator; giải thích push vs pull, delivery semantics, retention và rebalancing bằng số.',
  md: `
## Đề bài
> "Design a distributed message queue similar to Kafka. Producers publish messages to topics, consumers subscribe and read them, messages are persisted and delivered at least once with ordering inside a partition. It should scale to millions of messages per second."

Dịch: Thiết kế message queue phân tán kiểu Kafka. Producer publish vào topic, consumer subscribe và đọc, message được lưu bền và giao ít nhất một lần, giữ thứ tự trong một partition. Mở rộng tới hàng triệu message mỗi giây. Thời gian 45 phút.

## 1. Làm rõ yêu cầu (5 phút)
- Hỏi: Mô hình consumer: queue (mỗi message một consumer) hay pub/sub (nhiều nhóm cùng đọc)? → Đáp: cả hai, qua khái niệm consumer group.
- Hỏi: Message có cần đọc lại (replay) không? → Đáp: có, giữ 7 ngày, consumer mới có thể đọc từ đầu.
- Hỏi: Kích thước message? → Đáp: trung bình 1 KB, tối đa 1 MB.
- Hỏi: Thứ tự toàn topic hay trong partition? → Đáp: trong partition là đủ.
- Hỏi: Delivery semantics? → Đáp: at-least-once mặc định, nói thêm về exactly-once nếu được.
- Hỏi: Độ trễ? → Đáp: end-to-end dưới 100 ms ở p99 trong điều kiện bình thường.

Chốt lại:
- **Functional**: tạo topic với N partition; produce theo key; consume theo group với offset; replay theo offset hoặc timestamp; retention theo thời gian hoặc dung lượng.
- **Non-functional**: 1 triệu message/s; bền (không mất message đã ack); sẵn sàng khi mất 1 trong 3 broker; thứ tự trong partition; latency p99 dưới 100 ms.
- **Ngoài phạm vi**: schema registry, stream processing, transaction đa topic (chỉ nhắc).

## 2. Ước lượng (5 phút)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Ingress | 10^6 msg/s × 1 KB | ~1 GB/s |
| Ghi đĩa có replication 3 | 1 GB/s × 3 | ~3 GB/s toàn cụm |
| Egress | 3 consumer group mỗi topic | ~3 GB/s đọc |
| Dung lượng 7 ngày | 1 GB/s × 86 400 × 7 | ~600 TB, ×3 replica ≈ 1,8 PB |
| Số broker theo đĩa | 1,8 PB / 10 TB mỗi broker | ~180 broker |
| Số broker theo mạng | (3 + 3) GB/s / ~1 GB/s mỗi NIC 10 Gbps | ~6 broker là đủ về mạng |
| Số partition | 1 triệu msg/s / ~10k msg/s mỗi partition an toàn | ~100 partition cho topic lớn nhất |

Kết luận: **đĩa quyết định số broker**, không phải CPU hay mạng. Vì thế ghi tuần tự (sequential append) và zero-copy khi đọc là nền tảng thiết kế.

## 3. Thiết kế tổng thể (10–12 phút)
:::diagram
Producer[Producer] -> Meta[Metadata service KRaft hoặc ZooKeeper] : hỏi leader của partition
Producer -> Leader[Broker leader partition] : append batch, acks=all
Leader -> Log[Segment log trên đĩa + index]
Follower1[Broker follower ISR] -> Leader : fetch replicate
Follower2[Broker follower ISR] -> Leader : fetch replicate
Consumer[Consumer trong group] -> Coord[Group coordinator] : join, heartbeat, commit offset
Coord -> OffsetTopic[Topic __consumer_offsets]
Consumer -> Leader : fetch từ offset
Meta -> Leader : bầu leader, ISR
:::

**Luồng ghi**: producer tra metadata để biết leader của partition (chọn partition theo hash key hoặc round-robin), gom batch, gửi tới leader. Leader append vào segment đang mở, follower trong ISR (in-sync replicas) fetch và ghi; khi đủ ISR ack, leader tăng high watermark và trả ack cho producer. **Luồng đọc**: consumer trong group được coordinator gán partition; consumer **pull** từ leader theo offset, xử lý xong commit offset vào topic nội bộ; consumer chỉ đọc được tới high watermark.

| API | Mô tả | Ghi chú |
|---|---|---|
| CreateTopic(name, partitions, replication) | Tạo topic | metadata ghi vào KRaft |
| Produce(topic, key, value, acks) | Ghi batch | trả offset đầu của batch |
| Fetch(topic, partition, offset, maxBytes) | Đọc từ offset | long-poll chờ tới khi có dữ liệu |
| JoinGroup / SyncGroup / Heartbeat | Quản lý group | coordinator phân partition |
| CommitOffset(group, topic, partition, offset) | Lưu tiến độ | ghi vào __consumer_offsets |

Mô hình dữ liệu trên đĩa:
| Thành phần | Cấu trúc | Ghi chú |
|---|---|---|
| Partition | thư mục chứa nhiều segment | segment đóng là bất biến |
| Segment .log | append-only, 1 GB mỗi file | record = offset, timestamp, key, value, header, CRC |
| Index .index | sparse: offset → vị trí byte, mỗi 4 KB một entry | nhỏ, vừa RAM, mmap |
| Time index .timeindex | timestamp → offset | để seek theo thời gian |
| Metadata | topic, partition, leader, ISR, config | KRaft log hoặc ZooKeeper znode |

## 4. Đào sâu (15–18 phút)
### 4.1 Vì sao log append-only trên đĩa nhanh hơn "queue trong RAM"
- Ghi tuần tự trên SSD hoặc HDD đạt hàng trăm MB/s tới GB/s; ghi ngẫu nhiên chậm hơn hàng chục lần trên HDD. Append-only biến mọi ghi thành tuần tự.
- Không giữ message trong heap: dựa vào **page cache** của OS; consumer theo kịp producer thì đọc toàn từ RAM mà broker không quản lý bộ nhớ.
- **Zero-copy**: sendfile chuyển dữ liệu từ page cache thẳng ra socket, không qua user space; đọc của 3 consumer group không nhân CPU.
- Index sparse: tìm offset = binary search index trong RAM rồi đọc tuần tự vài KB trong .log.
| Phương án lưu | Ưu | Nhược |
|---|---|---|
| Queue trong RAM, xoá sau ack (RabbitMQ classic) | Latency thấp nhất | Không replay, backlog lớn thì tràn RAM hoặc page-out chậm |
| B-tree DB (bảng message) | Truy vấn linh hoạt | Ghi ngẫu nhiên, xoá tốn, không đạt 1 GB/s |
| Segment log append-only + index sparse | Ghi tuần tự, replay, retention bằng xoá file | Chỉ truy cập theo offset |

### 4.2 Replication: leader, ISR, acks và high watermark
- Mỗi partition có 1 leader và N−1 follower; chỉ leader nhận ghi và phục vụ đọc (đọc từ follower chỉ khi cần giảm chi phí cross-AZ).
- **ISR**: tập replica theo kịp leader trong replica.lag.time.max.ms (mặc định 30 s). Follower chậm bị loại khỏi ISR nhưng vẫn replicate.
- [[acks=0]]: không chờ, có thể mất; [[acks=1]]: leader ghi xong, mất nếu leader chết trước khi follower fetch; [[acks=all]] + [[min.insync.replicas=2]]: bền với 1 broker chết, latency tăng 1 round trip nội DC (~1 ms).
- **High watermark** = offset nhỏ nhất đã có ở mọi ISR; consumer chỉ thấy tới đó để không đọc message có thể bị rollback khi đổi leader.
- Leader chết: controller (KRaft) chọn leader mới **trong ISR**; [[unclean.leader.election=false]] thà mất sẵn sàng còn hơn mất dữ liệu.
| Cấu hình | Mất dữ liệu khi | Latency | Dùng khi |
|---|---|---|---|
| acks=1, RF=3 | leader chết ngay sau ack | thấp | log, metric |
| acks=all, min.isr=2, RF=3 | 2 broker chết đồng thời | +1 RTT | event nghiệp vụ, audit |
| acks=all, min.isr=3, RF=3 | 3 broker chết | cao, mất sẵn sàng khi 1 broker chết | hiếm khi đáng |

### 4.3 Consumer group, offset và rebalancing
- Một partition chỉ được **một consumer trong group** đọc; nhiều group đọc độc lập. Số consumer hữu ích tối đa = số partition, nên partition là đơn vị song song, phải chọn dư từ đầu (đổi số partition làm hỏng thứ tự theo key).
- Offset commit sau khi xử lý xong → at-least-once; commit trước khi xử lý → at-most-once. Commit theo batch để giảm ghi.
- **Rebalancing**: consumer vào hoặc ra, coordinator thu hồi và chia lại partition. Eager rebalance dừng cả group (stop-the-world) vài giây; cooperative incremental chỉ di chuyển partition cần thiết; static membership (group.instance.id) tránh rebalance khi consumer restart nhanh (hợp với deploy rolling).
- Heartbeat và session timeout: consumer xử lý quá lâu không poll thì bị coi là chết, partition bị lấy đi trong khi nó vẫn đang xử lý → **xử lý đúp**. Phải đặt max.poll.interval theo thời gian xử lý thật.

### 4.4 Push hay pull, và delivery semantics
| Tiêu chí | Push từ broker | Pull từ consumer |
|---|---|---|
| Kiểm soát tốc độ | Broker có thể đè consumer chậm | Consumer tự điều tiết, backpressure tự nhiên |
| Batching | Khó, broker phải đoán | Consumer gom bao nhiêu tuỳ ý |
| Độ trễ khi ít dữ liệu | Thấp | Long-poll với timeout giải quyết |
| Trạng thái ở broker | Phải nhớ consumer nào đã nhận gì | Chỉ nhớ offset do consumer commit |
Chọn pull với long-poll. Exactly-once trong Kafka = **idempotent producer** (sequence number theo producer id, broker dedup khi retry) + **transaction** (ghi nhiều partition và commit offset nguyên tử) + consumer đọc read_committed; chỉ giữ end-to-end exactly-once khi consumer ghi ra hệ ngoài cũng idempotent.

## 5. Trade-off & câu hỏi vặn (5 phút)
- *Why does ordering only hold inside a partition?* → Vì mỗi partition là một log độc lập trên broker khác nhau; thứ tự toàn cục cần một partition duy nhất và mất song song.
- *How do you pick the number of partitions?* → Theo throughput đích chia cho throughput một consumer, nhân dư 2 lần; quá nhiều partition tốn file handle, kéo dài leader election.
- *What if a consumer is slow?* → Lag tăng, có metric consumer lag; thêm consumer tới số partition, hoặc tăng partition và chấp nhận re-key.
- *Why not ZooKeeper anymore?* → KRaft đưa metadata vào chính Kafka bằng Raft, bớt một hệ thống phải vận hành và khởi động nhanh hơn với nhiều partition.
- *Retention by time or size?* → Cả hai, cái nào tới trước; log compaction giữ bản ghi mới nhất theo key cho topic trạng thái như __consumer_offsets.
- *How do you handle a 1 MB message?* → Cho phép max.message.bytes nhưng khuyến nghị để payload ở object storage, message chỉ chứa tham chiếu.
- *How does a producer survive a broker restart?* → Client refresh metadata khi nhận NotLeader, retry với backoff; ứng dụng dùng client phải xử lý reconnect, không coi connection là vĩnh viễn.
- *Can consumers read from followers?* → Có, follower fetching theo rack để giảm cross-AZ, chấp nhận trễ bằng replication lag.

## 6. Người phỏng vấn chấm gì
| Tiêu chí | Câu trả lời yếu | Câu trả lời mạnh |
|---|---|---|
| Lưu trữ | "Lưu message vào DB" | Segment append-only, index sparse, page cache, zero-copy, retention bằng xoá file |
| Độ bền | "Replicate 3 bản" | ISR, acks, min.insync.replicas, high watermark, unclean election |
| Consumer | "Consumer đọc rồi ack" | Group, offset commit, rebalance eager vs cooperative, max.poll.interval và xử lý đúp |
| Ước lượng | Không ra số broker | 1 GB/s ingress, 1,8 PB cho 7 ngày, đĩa quyết định |
| Semantics | "Kafka exactly-once" | Idempotent producer + transaction + sink idempotent |

**Nói thế nào trong phỏng vấn (EN)**
- "The core of a Kafka-like system is a partitioned, append-only log with a sparse index; everything else builds on sequential IO." — Lõi là log append-only phân partition với index thưa.
- "Durability comes from the ISR protocol: acks=all with min in-sync replicas of two survives one broker failure." — Độ bền đến từ ISR, acks=all với min ISR 2 chịu được một broker chết.
- "Consumers pull with long polling so they control their own pace and batching." — Consumer pull với long-poll để tự điều tiết.
- "Partitions are the unit of parallelism, so I would over-provision them up front." — Partition là đơn vị song song, nên dư ngay từ đầu.
- "Exactly-once means idempotent producers plus transactions, and the downstream sink still has to be idempotent." — Exactly-once là producer idempotent cộng transaction, sink vẫn phải idempotent.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Sự cố #1: publisher RabbitMQ singleton không reconnect sau khi broker bị recreate. Bài học từ client Kafka: connection là tài nguyên **có thể chết**, client phải refresh metadata và reconnect với backoff; wrap publisher bằng health check (channel đóng thì mở lại) và metric publish_errors_total.
- Sự cố #12: publish trước commit. Trong Kafka người ta dùng transactional outbox hoặc Kafka transactions; với RabbitMQ chỉ còn outbox: ghi bảng outbox cùng transaction, relay đọc và publish, đánh dấu sent.
- max.poll.interval và xử lý đúp soi vào worker: job eval policy chạy 17 phút trên project 90k component mà ack timeout ngắn thì message bị redeliver, hai worker cùng chạy. Đặt prefetch 1, ack sau khi xong, và idempotent theo run_id.
- Consumer lag là metric phải có trên RabbitMQ (queue depth, unacked) để bắt sự cố #2 khi Lambda không publish được và backlog pending phình.
- Partition là đơn vị song song: queue enrichment chia theo tenant hash để một tenant stress test 200k component (sự cố #16) không chiếm hết worker, giống partition theo key.
- Prefetch và ack: worker RabbitMQ đặt prefetch nhỏ và ack **sau** khi xử lý xong để message không mất khi worker bị OOM kill (sự cố #3); ack trước khi xử lý là at-most-once.
- RabbitMQ xoá message sau ack nên không replay được như Kafka; muốn tái xử lý enrichment thì nguồn sự thật phải là bảng trạng thái trong Postgres, không phải queue. Đó là lý do pending nằm ở DB và queue chỉ là tín hiệu đánh thức.
- Việc tuần này: thêm reconnect loop cho publisher và test bằng cách docker restart rabbitmq trên local; viết ADR "Outbox pattern cho audit và notification".
`,
  quiz: [
    { t: 'mc', q: 'Vì sao Kafka đạt throughput cao dù ghi message xuống đĩa thay vì giữ trong RAM?', o: ['Dùng đĩa NVMe đặc biệt', 'Ghi tuần tự append-only, dựa vào page cache và zero-copy sendfile', 'Nén message bằng thuật toán riêng', 'Chỉ ghi đĩa khi consumer chậm'], a: 1, why: 'Sequential IO và page cache của OS làm đĩa gần như RAM với workload đọc đuôi log.' },
    { t: 'mc', q: 'Cấu hình nào bảo đảm message đã ack không mất khi đúng 1 broker chết, với replication factor 3?', o: ['acks=1', 'acks=0 với retries lớn', 'acks=all và min.insync.replicas=2', 'acks=all và min.insync.replicas=1'], a: 2, why: 'min.isr=2 bắt ít nhất 2 bản ghi xong trước khi ack; min.isr=1 thì ack khi chỉ leader có dữ liệu.' },
    { t: 'mc', q: 'Consumer xử lý một message mất 10 phút, dài hơn max.poll.interval. Hậu quả?', o: ['Message bị xoá khỏi topic', 'Broker tạm dừng partition', 'Producer bị chặn ghi', 'Consumer bị coi là chết, partition giao cho consumer khác, message bị xử lý đúp'], a: 3, why: 'Rebalance lấy partition đi trong khi consumer cũ vẫn xử lý; cần đặt interval theo thời gian xử lý thật và idempotent.' },
    { t: 'mc', q: 'Consumer chỉ được đọc tới high watermark. Mục đích?', o: ['Tránh đọc message chưa được mọi ISR ghi, có thể bị mất khi đổi leader', 'Giảm tải cho leader', 'Giữ thứ tự giữa các partition', 'Để follower cũng phục vụ đọc'], a: 0, why: 'Message trên high watermark có thể bị truncate nếu leader chết trước khi follower đồng bộ.' },
    { t: 'mc', q: 'Lý do chính chọn pull thay vì push trong Kafka?', o: ['Pull có độ trễ thấp hơn trong mọi trường hợp', 'Consumer tự điều tiết tốc độ và gom batch, broker không cần nhớ trạng thái từng consumer', 'Push không hoạt động qua TCP', 'Pull không cần offset'], a: 1, why: 'Backpressure tự nhiên và broker chỉ cần lưu offset đã commit; long-poll bù cho độ trễ khi ít dữ liệu.' },
    { t: 'fill', q: 'Điền: tập replica đang theo kịp leader, dùng để quyết định ack và bầu leader mới an toàn, gọi là ___.', a: ['isr', 'in-sync replicas', 'in sync replicas'], why: 'Follower chậm bị loại khỏi ISR nhưng vẫn replicate; leader mới chỉ chọn từ ISR khi unclean election tắt.' },
    { t: 'fill', q: 'Điền: kỹ thuật chuyển dữ liệu từ page cache thẳng ra socket không qua user space, Kafka dùng khi consumer fetch, gọi là ___.', a: ['zero-copy', 'zero copy', 'sendfile'], why: 'Zero-copy làm chi phí đọc của nhiều consumer group gần như không tốn CPU broker.' },
    { t: 'open', q: 'Trình bày cách Kafka xử lý khi broker leader của một partition chết đột ngột, và dữ liệu nào có thể mất tuỳ cấu hình.', a: 'Controller (KRaft) phát hiện leader mất heartbeat, chọn leader mới trong ISR; metadata cập nhật, client nhận NotLeader và refresh. Follower mới làm leader truncate log về high watermark của mình. Với acks=all và min.insync.replicas=2 thì mọi message đã ack đều có ở ít nhất một ISR còn sống nên không mất. Với acks=1 message leader vừa ghi mà follower chưa fetch sẽ mất. Nếu bật unclean leader election thì replica ngoài ISR có thể làm leader và mất thêm dữ liệu; tắt nó để thà mất sẵn sàng. Producer retry với backoff và idempotent producer tránh ghi đúp khi retry.', keys: ['isr', 'controller', 'high watermark', 'acks', 'unclean'] }
  ]
},
{ id: 'C16', type: 'case', topic: 'db', title: 'Case: Design a hotel reservation system', time: '120 phút',
  goal: 'Thiết kế được hệ đặt phòng với bảng inventory theo ngày, chống double booking bằng ba cách (pessimistic, optimistic, constraint) và chọn đúng, overbooking có kiểm soát, reservation hold/expire, idempotent booking, ranh giới microservice và sharding theo hotel_id.',
  md: `
## Đề bài
> "Design a hotel reservation system like the one behind Marriott.com: users search hotels, view room types and prices, reserve and pay; hotel staff manage inventory. We have 5 000 hotels and 1 million rooms, and the business wants to allow 10 percent overbooking."

Dịch: Thiết kế hệ đặt phòng khách sạn kiểu Marriott: người dùng tìm khách sạn, xem loại phòng và giá, đặt và thanh toán; nhân viên quản lý tồn phòng. 5 000 khách sạn, 1 triệu phòng, cho phép overbooking 10%. Thời gian 45 phút.

## 1. Làm rõ yêu cầu (5 phút)
- Hỏi: Đặt theo **loại phòng** (deluxe, suite) hay phòng cụ thể (số 1203)? → Đáp: theo loại phòng; số phòng gán khi check-in.
- Hỏi: Overbooking 10% nghĩa là gì chính xác? → Đáp: số phòng đã đặt mỗi ngày được vượt tồn thật tối đa 10%, vì tỉ lệ huỷ cao.
- Hỏi: Thanh toán lúc đặt hay lúc nhận phòng? → Đáp: lúc đặt, qua PSP bên ngoài.
- Hỏi: Giá thay đổi theo ngày? → Đáp: có, giá theo (hotel, loại phòng, ngày).
- Hỏi: Giữ chỗ bao lâu trong lúc thanh toán? → Đáp: 10 phút.
- Hỏi: Quy mô người dùng? → Đáp: toàn cầu, nhưng mỗi khách sạn là đơn vị độc lập.

Chốt lại:
- **Functional**: tìm khách sạn còn phòng theo ngày; xem giá; tạo reservation (hold 10 phút) → thanh toán → xác nhận; huỷ; quản trị tồn phòng và giá.
- **Non-functional**: **không bao giờ** vượt quá tồn + 10% (strong consistency cho bước đặt); không double booking; sẵn sàng cao cho tìm kiếm; latency đặt phòng dưới 1 giây.
- **Ngoài phạm vi**: chương trình khách hàng thân thiết, kênh đại lý bên thứ ba, định giá động.

## 2. Ước lượng (5 phút)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Đêm phòng bán mỗi ngày | 1 triệu phòng × 70% lấp đầy | 700k đêm phòng |
| Reservation mới mỗi ngày | 700k / trung bình 3 đêm | ~240k reservation/ngày |
| TPS đặt phòng | 2,4 × 10^5 / 10^5 s, đỉnh ×10 | ~3 TPS trung bình, ~30 TPS đỉnh |
| Phễu | 1 đặt = 10 xem chi tiết = 100 tìm kiếm | tìm kiếm ~24 triệu/ngày ≈ 300 QPS, đỉnh 3 000 |
| Bảng inventory | 5 000 hotel × ~5 loại phòng × 365 ngày × 2 năm | ~18 triệu dòng × ~100 B ≈ 2 GB |
| Reservation lưu 5 năm | 240k × 365 × 5 × ~500 B | ~220 GB |

Kết luận: toàn bộ dữ liệu vừa **một Postgres**; 30 TPS ghi là rất nhỏ. Bài này về **consistency của bước đặt** và thiết kế bảng inventory, không phải sharding. Nói rõ điều này sớm, rồi nói sharding theo hotel_id là đường mở rộng.

## 3. Thiết kế tổng thể (10–12 phút)
:::diagram
Client[Web / Mobile] -> GW[API gateway]
GW -> Hotel[Hotel service] : tìm, chi tiết
GW -> Rate[Rate service] : giá theo ngày
GW -> Resv[Reservation service] : đặt, huỷ
GW -> Pay[Payment service]
Hotel -> HotelDB[Hotel DB + replica]
Hotel -> SCache[Search cache Redis]
Rate -> RateDB[Rate DB]
Resv -> ResvDB[Reservation DB Postgres inventory + reservation]
Pay -> PSP[PSP bên ngoài]
Resv -> MQ[Queue] : reservation events
MQ -> Notif[Notification / expire worker]
:::

**Luồng đặt phòng**: (1) client gọi POST /reservations/draft nhận reservation_id (dùng làm idempotency key); (2) POST /reservations với id đó: trong **một transaction** kiểm tra và trừ tồn cho từng ngày, tạo reservation trạng thái [[PENDING]] với expires_at = now + 10 phút; (3) client thanh toán; (4) Payment thành công → reservation [[CONFIRMED]]; thất bại hoặc hết hạn → [[CANCELLED]] và hoàn tồn. **Luồng tìm kiếm**: Hotel service đọc replica và cache; tồn phòng hiển thị là xấp xỉ, sự thật chỉ kiểm tra lúc đặt.

| Endpoint | Mô tả | Ghi chú |
|---|---|---|
| GET /v1/hotels?city&checkin&checkout&guests | Tìm khách sạn còn phòng | đọc cache, kết quả xấp xỉ |
| GET /v1/hotels/{id}/rooms?checkin&checkout | Loại phòng, giá, tồn | Rate + inventory replica |
| POST /v1/reservations/draft | Lấy reservation_id | id = idempotency key |
| POST /v1/reservations | Đặt (hold 10 phút) | body có reservation_id, hotel, room_type, ngày |
| POST /v1/reservations/{id}/confirm | Xác nhận sau thanh toán | gọi từ Payment callback |
| DELETE /v1/reservations/{id} | Huỷ | hoàn tồn |

Mô hình dữ liệu:
| Bảng | Key | Ghi chú |
|---|---|---|
| hotel, room_type | hotel_id, room_type_id | thông tin tĩnh |
| room_type_inventory | (hotel_id, room_type_id, date) | total_inventory, total_reserved, version |
| room_type_rate | (hotel_id, room_type_id, date) | price_minor, currency |
| reservation | reservation_id | hotel_id, room_type_id, checkin, checkout, guest_id, status, expires_at, amount |
| reservation_day | (reservation_id, date) | để hoàn tồn đúng từng ngày |

Inventory **theo ngày** chứ không theo phòng: đặt 3 đêm = 3 dòng inventory cần trừ; tổng dòng 18 triệu, index primary key theo (hotel_id, room_type_id, date) nên mọi truy vấn cho một hotel nằm gọn trong vài page.

## 4. Đào sâu (15–18 phút)
### 4.1 Chống double booking: ba cách và khi nào dùng
Bài toán: hai khách cùng đặt phòng cuối cùng của ngày 20/12 trong cùng mili giây.
~~~sql
-- Cách 3: điều kiện ngay trong UPDATE, DB làm trọng tài
UPDATE room_type_inventory
SET total_reserved = total_reserved + 1
WHERE hotel_id = $1 AND room_type_id = $2 AND date = $3
  AND total_reserved + 1 <= total_inventory * 1.10;
-- rows affected = 0 nghĩa là hết phòng, rollback cả transaction
~~~
| Phương án | Cách làm | Ưu | Nhược | Dùng khi |
|---|---|---|---|---|
| Pessimistic lock | SELECT ... FOR UPDATE rồi kiểm tra và UPDATE | Đơn giản, chắc chắn | Khoá giữ suốt transaction, deadlock nếu khoá nhiều ngày sai thứ tự | Tranh chấp cao, transaction ngắn |
| Optimistic lock | Đọc version, UPDATE ... WHERE version = cũ, retry khi 0 dòng | Không giữ khoá, đọc tự do | Retry nhiều khi tranh chấp cao, code phải có vòng lặp | Tranh chấp thấp (đa số khách sạn) |
| DB constraint trong UPDATE | Điều kiện tồn ngay trong UPDATE hoặc CHECK constraint | Một câu lệnh, không cần version, không race | Chỉ hoạt động khi điều kiện biểu diễn được bằng SQL | Bộ đếm có giới hạn như tồn phòng |

Chọn phương án 3 cho inventory (kết hợp CHECK constraint [[total_reserved <= total_inventory * 1.10]] làm lưới an toàn), khoá các ngày **theo thứ tự tăng dần** để tránh deadlock khi đặt nhiều đêm, isolation level READ COMMITTED là đủ vì UPDATE tự lấy row lock và đánh giá lại điều kiện trên bản mới nhất. Nói thêm: với SERIALIZABLE thì chỉ cần SELECT rồi UPDATE nhưng phải retry lỗi serialization.

### 4.2 Idempotent booking và hold/expire
- Double-submit (bấm hai lần, mạng chập chờn) khác double booking: cùng một khách tạo hai reservation. Giải quyết bằng reservation_id lấy trước từ /draft và UNIQUE; request thứ hai trả reservation hiện có.
- Hold 10 phút: reservation PENDING đã trừ tồn. Worker quét [[WHERE status = PENDING AND expires_at < now()]] mỗi 30 giây, chuyển CANCELLED và hoàn tồn trong một transaction; hoặc dùng Redis key TTL làm trigger và DB làm sự thật. Confirm đến muộn sau khi đã expire → kiểm tra trạng thái, nếu CANCELLED thì **thử đặt lại**, không được thì hoàn tiền.
- Thanh toán và đặt phòng là hai hệ: dùng saga đơn giản PENDING → thanh toán → CONFIRMED, bù bằng hoàn tồn và hoàn tiền; event đi qua outbox để không mất khi crash giữa chừng.

### 4.3 Overbooking và nhất quán giữa tìm kiếm với đặt
- Overbooking là **chính sách nghiệp vụ** mã hoá thành hệ số trong điều kiện UPDATE, cấu hình theo hotel (bảng hotel.overbook_ratio), không hard-code 1.10.
- Tìm kiếm hiển thị tồn từ cache và replica, có thể lệch vài giây; chấp nhận vì bước đặt mới là trọng tài. Thông báo cho người dùng "phòng vừa hết" là trải nghiệm bình thường ở mọi hệ đặt phòng.
- Cache tìm kiếm theo (city, checkin, checkout) TTL 1 phút; invalidate theo hotel khi tồn về 0.
| Nơi kiểm tra tồn | Độ chính xác | Chi phí |
|---|---|---|
| Cache tìm kiếm | Xấp xỉ, trễ 1 phút | Rất rẻ |
| Replica khi xem chi tiết | Trễ vài giây | Rẻ |
| Primary trong transaction đặt | Chính xác tuyệt đối | Đắt nhưng chỉ 30 TPS |

### 4.4 Ranh giới service, sharding và cache
- Tách Hotel (đọc nhiều, tĩnh), Rate (thay đổi theo chiến dịch), Reservation (giao dịch, consistency cao), Payment (bên ngoài). Reservation và inventory **cùng một DB** để dùng ACID; không tách inventory thành service riêng vì sẽ phải phát minh lại transaction.
- Sharding khi cần: theo [[hotel_id]], vì mọi thao tác đặt phòng chỉ chạm một hotel; truy vấn "tìm theo thành phố" đi qua index phụ hoặc Elasticsearch, không đụng shard inventory. 5 000 hotel chưa cần shard; nói rõ ngưỡng (ví dụ 50 TB hoặc 10k TPS ghi) sẽ cân nhắc.
- Dữ liệu Marriott-scale thực tế vẫn vừa Postgres cỡ lớn; không shard sớm là một quyết định senior.

## 5. Trade-off & câu hỏi vặn (5 phút)
- *Why inventory per day instead of per room?* → Đặt theo loại phòng; số dòng nhỏ gấp trăm lần; gán phòng cụ thể lúc check-in là bài khác.
- *Why not Redis DECR for inventory?* → Nhanh nhưng không atomic với bảng reservation, mất khi Redis chết; DB là sự thật, Redis chỉ là cache hoặc hold timer.
- *What isolation level?* → READ COMMITTED đủ với UPDATE có điều kiện; SERIALIZABLE nếu muốn logic đọc rồi ghi, nhưng phải retry.
- *Deadlock when booking 3 nights?* → Khoá theo thứ tự ngày tăng dần trong mọi transaction; Postgres phát hiện deadlock trong 1 giây và huỷ một bên, code retry.
- *Payment succeeded but confirm failed?* → Saga: job đối soát reservation PENDING đã có payment thành công; confirm lại hoặc hoàn tiền; mọi bước idempotent theo reservation_id.
- *Hotel reduces inventory below current reservations?* → Cho phép, total_reserved vượt total_inventory tạm thời, cảnh báo nhân viên; không xoá reservation.
- *How to shard if needed?* → Theo hotel_id; tìm kiếm qua index phụ; không shard theo guest_id vì đặt phòng chạm inventory của hotel.
- *What is overbooking risk management?* → Tỉ lệ theo hotel dựa trên lịch sử huỷ; alert khi số đến thực vượt tồn để xử lý thủ công (nâng hạng, chuyển khách sạn).

## 6. Người phỏng vấn chấm gì
| Tiêu chí | Câu trả lời yếu | Câu trả lời mạnh |
|---|---|---|
| Mô hình dữ liệu | Bảng room và cột is_booked | Inventory theo (hotel, room_type, date) với total_reserved |
| Concurrency | "Dùng lock" | Ba phương án, SQL cụ thể, chọn UPDATE có điều kiện và giải thích isolation |
| Ước lượng | Bỏ qua | 30 TPS đỉnh, 2 GB inventory, một Postgres đủ |
| Nghiệp vụ | Quên overbooking hoặc hard-code | Hệ số cấu hình theo hotel, tìm kiếm xấp xỉ, đặt chính xác |
| Ranh giới | Tách inventory thành service riêng | Reservation + inventory chung DB vì ACID, shard theo hotel_id khi cần |

**Nói thế nào trong phỏng vấn (EN)**
- "The write volume is tiny, about thirty bookings per second at peak, so the hard part is correctness under concurrency, not scale." — Ghi rất nhỏ, khó ở concurrency chứ không phải scale.
- "I model inventory per hotel, room type and date, and let the database enforce the limit inside a conditional UPDATE." — Inventory theo hotel, loại phòng, ngày; DB ép giới hạn trong UPDATE có điều kiện.
- "Optimistic locking suits low contention, pessimistic suits hot rows; a constraint-in-update avoids both retries and long locks." — Optimistic cho tranh chấp thấp, pessimistic cho dòng nóng, điều kiện trong UPDATE tránh cả hai.
- "Search shows approximate availability; the reservation transaction is the single arbiter." — Tìm kiếm là xấp xỉ, transaction đặt là trọng tài duy nhất.
- "I would keep reservation and inventory in one database for ACID and shard by hotel id only when the numbers demand it." — Giữ reservation và inventory chung DB, chỉ shard theo hotel khi số liệu bắt buộc.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- UPDATE có điều kiện là vũ khí chính cho status machine enrichment: [[UPDATE prcl SET status='enriched' WHERE id=$1 AND status='pending']] để sweeper và inline không ghi đè nhau; rows affected = 0 nghĩa là ai đó đã làm rồi.
- Khoá theo thứ tự cố định tránh deadlock: khi policy eval ghi violation cho nhiều target trong một transaction, sort theo target_id trước; worker 10 goroutine song song (sự cố #3) từng gây lock wait vì không có thứ tự.
- Hold/expire soi vào lease của job: sweeper claim dòng pending bằng [[claimed_until = now() + 5 phút]]; dòng quá hạn mới được claim lại, tránh hai Lambda xử lý cùng batch.
- "Tìm kiếm xấp xỉ, đặt chính xác" là cách nói với khách hàng về Portfolio dashboard: số đọc từ snapshot có thể trễ vài phút, số trong Target Details là sự thật.
- Sharding theo hotel_id tương đương partition bảng violation theo tenant_id (sự cố #6): mọi truy vấn đều có tenant_id, partition pruning cắt 9,6 triệu dòng về vài trăm nghìn.
- Idempotent booking qua id lấy trước tương đương import_id sinh ở FE trước khi upload: retry upload cùng id không tạo hai revision, server trả lại import hiện có.
- Overbooking là tham số nghiệp vụ theo hotel gợi ý ngưỡng policy (severity, EOL grace period) nên cấu hình theo tenant trong bảng, không hard-code trong evaluator.
- Việc tuần này: grep các UPDATE trạng thái thiếu điều kiện WHERE status cũ trong worker và thêm vào; viết test concurrency 50 goroutine cùng update một dòng.
`,
  quiz: [
    { t: 'mc', q: 'Hai khách đặt phòng cuối cùng cùng lúc. Phương án nào chặn double booking bằng một câu lệnh mà không cần version hay SELECT FOR UPDATE?', o: ['Đặt isolation REPEATABLE READ', 'UPDATE ... SET total_reserved = total_reserved + 1 WHERE ... AND total_reserved + 1 <= total_inventory, kiểm tra rows affected', 'Dùng Redis DECR trước khi ghi DB', 'Xử lý tuần tự bằng một worker'], a: 1, why: 'UPDATE lấy row lock và đánh giá lại điều kiện trên bản mới nhất; 0 dòng nghĩa là hết phòng.' },
    { t: 'mc', q: 'Optimistic locking phù hợp nhất khi nào?', o: ['Tranh chấp cao trên ít dòng', 'Transaction rất dài', 'Cần khoá nhiều bảng', 'Tranh chấp thấp, hiếm khi hai transaction cùng sửa một dòng'], a: 3, why: 'Optimistic không giữ khoá nhưng retry khi xung đột; tranh chấp cao làm retry bùng nổ.' },
    { t: 'mc', q: 'Vì sao mô hình inventory theo (hotel, room_type, date) thay vì theo từng phòng cụ thể?', o: ['Khách đặt theo loại phòng, số dòng nhỏ hơn hàng trăm lần, gán phòng cụ thể lúc check-in', 'Postgres không lưu được 1 triệu dòng phòng', 'Để tránh phải dùng transaction', 'Để hỗ trợ overbooking tự động'], a: 0, why: 'Mô hình theo loại phòng khớp nghiệp vụ và làm phép trừ tồn thành bộ đếm đơn giản.' },
    { t: 'mc', q: 'Đặt 3 đêm liên tiếp, hai transaction cùng khoá 3 dòng inventory và bị deadlock. Cách phòng ngừa?', o: ['Tăng lock_timeout', 'Dùng isolation SERIALIZABLE', 'Khoá các ngày theo thứ tự tăng dần trong mọi transaction', 'Tách mỗi đêm một transaction'], a: 2, why: 'Thứ tự khoá nhất quán loại bỏ chu trình chờ; tách transaction làm mất tính nguyên tử của đặt phòng.' },
    { t: 'mc', q: 'Payment thành công nhưng reservation đã hết hold 10 phút và bị CANCELLED. Xử lý đúng?', o: ['Giữ CANCELLED và không làm gì', 'Chuyển thẳng sang CONFIRMED bỏ qua tồn', 'Thử đặt lại tồn; nếu không được thì hoàn tiền; mọi bước idempotent theo reservation_id', 'Tạo reservation mới cho khách'], a: 2, why: 'Saga với bước bù: ưu tiên hoàn tất ý định của khách, không vi phạm tồn, không mất tiền.' },
    { t: 'fill', q: 'Điền: chính sách cho phép số phòng đặt vượt tồn thật một tỉ lệ vì dự đoán có huỷ gọi là ___.', a: ['overbooking', 'over booking'], why: 'Overbooking là tham số nghiệp vụ theo hotel, mã hoá vào điều kiện UPDATE.' },
    { t: 'fill', q: 'Điền: lấy reservation_id trước từ endpoint draft rồi dùng nó làm ___ key để request lặp không tạo hai đặt phòng.', a: ['idempotency', 'idempotent'], why: 'UNIQUE trên reservation_id biến double-submit thành trả lại kết quả cũ.' },
    { t: 'open', q: 'So sánh pessimistic lock, optimistic lock và điều kiện trong UPDATE cho bài trừ tồn phòng; nêu khi nào mỗi cách thắng.', a: 'Pessimistic (SELECT FOR UPDATE) khoá dòng suốt transaction, chắc chắn và đơn giản, hợp khi tranh chấp cao và transaction ngắn, nhưng dễ deadlock khi khoá nhiều dòng sai thứ tự. Optimistic dùng cột version và UPDATE WHERE version = cũ, không giữ khoá, hợp tranh chấp thấp, nhưng cần vòng retry và tốn khi tranh chấp cao. Điều kiện trong UPDATE (total_reserved + 1 <= total_inventory) để DB tự đánh giá trên bản mới nhất, một câu lệnh, không version, không retry, hợp mọi bộ đếm có giới hạn như tồn phòng, cộng CHECK constraint làm lưới an toàn. Với READ COMMITTED cách 3 đủ đúng; khoá theo thứ tự ngày để tránh deadlock.', keys: ['for update', 'version', 'điều kiện', 'deadlock', 'retry'] }
  ]
},
{ id: 'C17', type: 'case', topic: 'scale', title: 'Case: Design a web crawler', time: '120 phút',
  goal: 'Thiết kế được crawler 1 tỷ trang/tháng với URL frontier có priority và politeness per host, dedup URL bằng Bloom filter và nội dung bằng SimHash, robots.txt, trap detection, frontier phân tán shard theo host, và lịch recrawl theo freshness.',
  md: `
## Đề bài
> "Design a web crawler for a search engine. It should fetch about one billion pages per month, respect robots.txt, avoid overloading any single website, handle duplicate content and crawler traps, and keep the index reasonably fresh."

Dịch: Thiết kế web crawler cho search engine: tải khoảng 1 tỷ trang mỗi tháng, tôn trọng robots.txt, không làm quá tải website nào, xử lý nội dung trùng và bẫy crawler, giữ index tương đối mới. Thời gian 45 phút.

## 1. Làm rõ yêu cầu (5 phút)
- Hỏi: Mục đích crawl? → Đáp: lập chỉ mục tìm kiếm; chỉ HTML, bỏ ảnh, video, PDF.
- Hỏi: Có render JavaScript không? → Đáp: không trong phiên bản đầu.
- Hỏi: Lưu HTML bao lâu? → Đáp: 5 năm, để re-index khi đổi thuật toán.
- Hỏi: Freshness? → Đáp: trang tin tức vài giờ, trang tĩnh vài tuần; crawler tự học tần suất đổi.
- Hỏi: Politeness? → Đáp: tối đa 1 request mỗi giây tới một host trừ khi robots.txt cho phép khác; tuân thủ Crawl-delay.
- Hỏi: Ưu tiên? → Đáp: theo PageRank xấp xỉ và tần suất cập nhật; seed từ danh sách domain lớn.

Chốt lại:
- **Functional**: nhận seed URL; tải trang; trích link; lọc và dedup URL; dedup nội dung; lưu HTML và metadata; lên lịch recrawl; tuân thủ robots.txt.
- **Non-functional**: 1 tỷ trang/tháng ổn định; lịch sự với host; chịu lỗi (worker chết không mất frontier); mở rộng ngang; bảo vệ khỏi trap và trang độc hại.
- **Ngoài phạm vi**: render JS, lập chỉ mục văn bản, xếp hạng.

## 2. Ước lượng (5 phút)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Trang/giây trung bình | 10^9 / (30 × 86 400 ≈ 2,6 × 10^6 s) | ~400 trang/s |
| Đỉnh | ×2 | ~800 trang/s |
| Băng thông tải | 400 × 500 KB (HTML trung bình kể cả inline) | ~200 MB/s ≈ 1,6 Gbps |
| Lưu HTML/tháng | 10^9 × 500 KB | ~500 TB/tháng, nén gzip ~5 lần → ~100 TB/tháng |
| Lưu 5 năm | 100 TB × 60 | ~6 PB nén |
| Kết nối đồng thời | 400 trang/s × latency 1 s trung bình | ~400 đến 800 kết nối mở |
| URL seen | 10^9 URL/tháng, 10^10 trong vài năm; Bloom filter 1% FP ≈ 9,6 bit/URL | 10^10 × 9,6 bit ≈ 12 GB |
| Link trích mỗi trang | ~50 link, 90% đã thấy | 400 × 50 = 20k URL/s vào bộ lọc, ~2k URL/s mới vào frontier |

Kết luận: 400 trang/giây là nhỏ về compute (vài chục worker); cái khó là **frontier** (hàng tỷ URL chờ, ưu tiên, lịch sự) và **dedup** ở quy mô 10^10.

## 3. Thiết kế tổng thể (10–12 phút)
:::diagram
Seed[Seed URLs] -> Frontier[URL frontier priority + politeness]
Frontier -> Fetcher[Fetcher workers]
Fetcher -> DNS[DNS resolver + cache]
Fetcher -> Robots[robots.txt cache]
Fetcher -> Web[Websites]
Fetcher -> Store[HTML storage S3 + metadata DB]
Fetcher -> Parser[Content parser]
Parser -> CSeen[Content seen SimHash]
Parser -> Extractor[Link extractor]
Extractor -> Filter[URL filter blacklist + robots + normalize]
Filter -> USeen[URL seen Bloom filter + KV]
USeen -> Frontier : URL mới
Sched[Recrawl scheduler] -> Frontier : URL cũ đến hạn
:::

**Luồng chính**: frontier phát URL theo ưu tiên nhưng mỗi host không quá 1 request/giây → fetcher tra DNS cache, kiểm robots.txt (cache theo host, TTL 1 ngày), tải trang với timeout → lưu HTML thô vào S3 và metadata (url, fetch_time, status, content_hash, simhash) vào DB → parser kiểm trùng nội dung bằng SimHash; nếu mới thì trích link → chuẩn hoá URL (lowercase host, bỏ fragment, sắp xếp query) → lọc blacklist và robots → kiểm Bloom filter; URL chưa thấy vào frontier với ưu tiên tính từ host score và độ sâu.

| Thành phần hoặc API nội bộ | Mô tả | Ghi chú |
|---|---|---|
| frontier.Push(url, priority, host) | Đưa URL vào hàng đợi | shard theo hash(host) |
| frontier.Pop(workerId) | Lấy URL sẵn sàng theo politeness | trả URL mà host đã hết thời gian chờ |
| fetcher.Fetch(url) | Tải với timeout 10 s, giới hạn 5 MB | theo redirect tối đa 5 |
| seen.CheckAndAdd(urlHash) | Bloom filter rồi KV xác nhận | FP 1% thì bỏ sót 1% URL mới, chấp nhận |
| store.Put(url, html, meta) | Lưu S3 và metadata | key = sha256(url) |
| sched.Due(now) | Lấy URL đến hạn recrawl | theo next_fetch_at |

Mô hình dữ liệu:
| Bảng | Key | Ghi chú |
|---|---|---|
| page_meta | url_hash | url, host, last_fetch_at, next_fetch_at, status, content_hash, simhash, change_rate, depth |
| host_state | host | robots_txt cache, crawl_delay, last_access_at, error_count, score |
| frontier queue | shard = hash(host) % N | front queue theo priority, back queue theo host |
| html object | s3://crawl/{yyyymm}/{url_hash}.gz | bất biến, giữ nhiều phiên bản theo thời gian |

## 4. Đào sâu (15–18 phút)
### 4.1 URL frontier: ưu tiên và lịch sự cùng lúc (thiết kế Mercator)
Vấn đề: muốn trang quan trọng được tải trước, nhưng không bắn 100 request/giây vào cùng một host dù host đó quan trọng.
- **Front queues** theo ưu tiên (ví dụ 10 mức): prioritizer đặt URL vào queue theo điểm; selector lấy từ queue cao nhiều hơn queue thấp (weighted random, tránh starvation).
- **Back queues** theo host: mỗi host một queue; bảng host → queue và một **min-heap theo thời gian được phép truy cập tiếp** (last_access + delay). Worker lấy host có thời gian đến hạn sớm nhất; queue host rỗng thì nạp URL mới từ front queue.
- Số back queue ≈ 3 lần số worker để worker luôn có host sẵn sàng.
- Lưu frontier trên đĩa (Redis sorted set hoặc RocksDB), chỉ giữ đầu queue trong RAM; hàng tỷ URL không vừa RAM.
| Phương án frontier | Ưu | Nhược |
|---|---|---|
| Một hàng FIFO | Đơn giản | Không ưu tiên, một host lớn chiếm hết, bị trap kéo vào |
| Priority queue duy nhất | Có ưu tiên | Vi phạm politeness: 1 000 URL cùng host liên tiếp |
| Front queue + back queue theo host + heap thời gian | Ưu tiên và lịch sự tách bạch | Phức tạp, cần bảng host, nhiều queue |

### 4.2 Dedup URL (Bloom filter) và dedup nội dung (SimHash)
- URL seen: Bloom filter 12 GB trong RAM cho 10^10 URL với 1% false positive; FP nghĩa là **bỏ qua** một URL mới, chấp nhận được; không có false negative nên không tải lại trùng. Khi cần chính xác, kiểm thêm KV store sau khi Bloom nói "có".
- Nội dung trùng gần (near-duplicate: cùng bài báo khác quảng cáo, khác ngày in): hash chính xác (MD5) không bắt được. **SimHash** 64 bit: băm từng feature (shingle từ) và cộng trọng số theo bit; hai trang có Hamming distance ≤ 3 coi là trùng. Tìm nhanh bằng chia 64 bit thành 4 khối 16 bit và index theo từng khối (pigeonhole: khác ≤ 3 bit thì ít nhất 1 khối giống hệt).
| Kỹ thuật | Bắt được | Chi phí |
|---|---|---|
| MD5 hoặc SHA của HTML | Trùng y hệt | 1 hash, 1 lookup |
| SimHash + Hamming ≤ 3 | Trùng gần | 64 bit mỗi trang, 4 lookup theo khối |
| MinHash + LSH | Trùng gần với ngưỡng Jaccard | Nhiều hash hơn, chính xác hơn |

### 4.3 robots.txt, trap và host xấu
- robots.txt cache theo host TTL 24 giờ; không có file thì coi như cho phép; tôn trọng Disallow, Crawl-delay, Sitemap. Lỗi 5xx khi lấy robots.txt → tạm không crawl host đó.
- Trap: lịch vô hạn, session id trong URL, chuỗi redirect, trang sinh link vô tận. Phòng thủ: giới hạn **độ sâu** 20, **độ dài URL** 2 KB, số URL **mỗi host mỗi ngày**, phát hiện URL pattern lặp (cùng path khác tham số), giảm ưu tiên host có tỉ lệ nội dung trùng cao; blacklist thủ công.
- Isolation lỗi: host trả lỗi liên tục thì tăng backoff cho host đó (error_count), **không** dừng worker; worker chết giữa chừng thì URL có lease hết hạn quay lại frontier.

### 4.4 Phân tán frontier và recrawl theo freshness
- Shard frontier theo [[hash(host) % N]]: mọi URL của một host ở cùng shard nên politeness là **cục bộ**, không cần khoá phân tán. Mỗi shard có nhóm fetcher riêng; thêm shard khi mở rộng (consistent hashing để ít di chuyển).
- DNS: resolver riêng với cache, vì 400 trang/giây có thể là 400 host khác nhau và DNS public mất 20 đến 100 ms; nhiều host lớn trả nhiều IP, xoay vòng để không dồn một IP.
- Freshness: mỗi trang có change_rate ước lượng theo lịch sử (so content_hash giữa các lần). Trang đổi thường xuyên recrawl sau vài giờ; trang không đổi 5 lần liên tiếp thì giãn gấp đôi, tối đa 60 ngày (adaptive, giống TCP backoff). next_fetch_at ghi vào page_meta, scheduler đẩy URL đến hạn vào frontier với ưu tiên cao hơn URL mới chưa biết.
- Lưu HTML theo phiên bản: cùng url_hash nhiều object theo tháng, để diff và re-index.

## 5. Trade-off & câu hỏi vặn (5 phút)
- *Why not just a distributed priority queue?* → Vì nó không biết host; ưu tiên và lịch sự là hai trục khác nhau, phải tách front và back queue.
- *What does a 1 percent false positive in the Bloom filter cost?* → Bỏ sót 1% URL mới ở lần gặp đầu; thường gặp lại từ trang khác; đổi sang 0,1% chỉ tốn thêm ~50% RAM.
- *How do you know a page changed without downloading it?* → HTTP conditional GET với If-Modified-Since và ETag; 304 rẻ hơn tải lại.
- *How do you crawl JavaScript-heavy sites?* → Headless browser pool riêng, đắt gấp 10 đến 50 lần, chỉ cho host có giá trị cao.
- *What if one shard owner dies?* → Frontier persist trên đĩa hoặc Redis có replica; URL đang fetch có lease, hết hạn thì về frontier; shard được gán lại qua coordinator.
- *How do you avoid being blocked?* → Chính politeness: delay theo host, User-Agent rõ ràng có trang liên hệ, tuân thủ robots, backoff khi 429 hoặc 503.
- *How to prioritize?* → Điểm = f(host authority, số inbound link, change_rate, depth); tin tức lên front queue cao nhất.
- *Storage format?* → HTML gzip trong S3 theo WARC hoặc object riêng; metadata trong Postgres hoặc Cassandra tuỳ 10^10 dòng.

## 6. Người phỏng vấn chấm gì
| Tiêu chí | Câu trả lời yếu | Câu trả lời mạnh |
|---|---|---|
| Frontier | Một queue | Front queue ưu tiên, back queue theo host, heap thời gian, shard theo host |
| Dedup | Chỉ hash URL | Bloom filter với số liệu RAM, SimHash cho near-duplicate |
| Lịch sự | Nhắc robots.txt rồi thôi | Crawl-delay, 1 req/s/host, backoff theo host, User-Agent, 429 |
| Chịu lỗi | Không nói | Lease URL, host lỗi không dừng worker, frontier persist |
| Freshness | Crawl lại tất cả định kỳ | Adaptive theo change_rate, conditional GET, lưu nhiều phiên bản |

**Nói thế nào trong phỏng vấn (EN)**
- "Four hundred pages per second is cheap to fetch; the real problem is the frontier: billions of URLs, priority and politeness at the same time." — Tải 400 trang/giây là rẻ, vấn đề thật là frontier.
- "I separate priority from politeness: front queues by priority, back queues per host with a heap of next-allowed times." — Tách ưu tiên khỏi lịch sự bằng front queue và back queue theo host.
- "A Bloom filter of about twelve gigabytes covers ten billion URLs at one percent false positives, which only means skipping a few new URLs." — Bloom filter 12 GB cho 10 tỷ URL, FP 1% chỉ là bỏ sót vài URL mới.
- "SimHash with Hamming distance three catches near-duplicates that exact hashing misses." — SimHash khoảng cách Hamming 3 bắt trùng gần.
- "Sharding the frontier by host keeps politeness local, so no distributed lock is needed." — Shard theo host làm politeness cục bộ, không cần khoá phân tán.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Enrichment gọi ClearlyDefined, OSV, NVD, GHSA theo batch là một crawler thu nhỏ: mỗi nguồn là một "host" cần **politeness** riêng (rate limit per host, backoff khi 429/503), không phải một rate limit chung cho mọi nguồn.
- Sự cố #7 (một coordinate version-range làm hỏng cả batch, FetchBatch nuốt lỗi) là lỗi "trap kéo sập worker": cách crawler làm là isolate theo item và theo host: item lỗi thì đánh dấu riêng (no_locator, failed với lý do), host lỗi thì backoff host đó, batch còn lại vẫn đi tiếp.
- Frontier front/back queue soi vào sweeper: front queue theo ưu tiên (tenant trả tiền, upload mới) và back queue theo nguồn API; "100 dòng pending cũ nhất" (sự cố #8) là một FIFO không ưu tiên, zombie chiếm chỗ y hệt trap chiếm frontier.
- Bloom filter cho "coordinate đã tra, không có locator": tránh gọi lại API cho 200k component không purl (sự cố #16) mỗi lần sweep.
- Adaptive recrawl = lịch re-sync vulnerability theo change_rate: package phổ biến có CVE mới thường xuyên thì sync hằng ngày, package 5 lần không đổi thì giãn.
- Conditional GET với ETag khi gọi lại ClearlyDefined cho coordinate đã có để tiết kiệm quota.
- URL seen và content seen là dedup hai lớp; với component: identity hash theo purl chuẩn hoá (lớp URL) và hash nội dung license text (lớp content) để không lưu lặp cùng license dưới tên khác (bug identity hash khác nhau giữa parser SPDX và CDX).
- Lưu nhiều phiên bản HTML tương đương giữ raw kết quả enrichment theo fetched_at thay vì ghi đè, để so sánh khi ClearlyDefined đổi dữ liệu và giải thích vì sao license của tenant thay đổi.
- Việc tuần này: thêm bảng host_state cho từng nguồn API (error_count, backoff_until) và metric 429 theo nguồn; viết test một coordinate lỗi không làm fail batch.
`,
  quiz: [
    { t: 'mc', q: 'Vì sao frontier cần cả front queue theo ưu tiên và back queue theo host?', o: ['Để tăng throughput đọc đĩa', 'Vì ưu tiên và lịch sự là hai trục khác nhau: queue ưu tiên đơn thuần sẽ bắn liên tiếp nhiều URL cùng host', 'Để dedup URL', 'Vì Redis không hỗ trợ priority queue'], a: 1, why: 'Back queue theo host với heap thời gian bảo đảm delay giữa hai request cùng host bất kể ưu tiên.' },
    { t: 'mc', q: 'Bloom filter cho URL seen trả lời "đã thấy" với false positive 1%. Hệ quả thực tế?', o: ['Bỏ qua 1% URL thật sự mới ở lần gặp đầu, không tải trùng', 'Tải trùng 1% trang', 'Sai lệch ưu tiên', 'Mất 1% HTML đã lưu'], a: 0, why: 'Bloom không có false negative nên không tải trùng; FP làm bỏ sót URL mới, thường gặp lại sau.' },
    { t: 'mc', q: 'Hai bài báo giống nhau 95% nhưng khác quảng cáo và ngày. Kỹ thuật nào phát hiện trùng?', o: ['MD5 của HTML', 'So sánh độ dài trang', 'SimHash với Hamming distance nhỏ', 'So sánh URL đã chuẩn hoá'], a: 2, why: 'Hash chính xác đổi hoàn toàn khi khác 1 byte; SimHash giữ gần nhau cho nội dung gần giống.' },
    { t: 'mc', q: 'Một host trả 503 liên tục. Crawler nên?', o: ['Dừng toàn bộ worker để tránh lỗi lan', 'Xoá host khỏi frontier vĩnh viễn', 'Retry ngay lập tức 10 lần', 'Tăng backoff riêng cho host đó, worker tiếp tục host khác'], a: 3, why: 'Lỗi phải được cô lập theo host; dừng worker làm một host xấu kéo cả hệ thống.' },
    { t: 'mc', q: 'Shard frontier theo hash(host) có lợi ích gì cho politeness?', o: ['Giảm dung lượng Bloom filter', 'Mọi URL một host ở cùng shard nên delay theo host kiểm soát cục bộ, không cần khoá phân tán', 'Tăng ưu tiên cho host lớn', 'Cho phép bỏ robots.txt'], a: 1, why: 'Politeness là trạng thái theo host; gom host vào một shard tránh hai worker ở hai shard cùng bắn vào host.' },
    { t: 'fill', q: 'Điền: cấu trúc xác suất dùng vài hash function và một mảng bit để kiểm tra phần tử đã thấy, có false positive nhưng không có false negative, gọi là ___ filter.', a: ['bloom', 'bloom filter'], why: 'Khoảng 9,6 bit mỗi phần tử cho 1% FP; 10 tỷ URL cần ~12 GB.' },
    { t: 'fill', q: 'Điền: file ở gốc website khai báo đường dẫn cho phép hoặc cấm crawler và Crawl-delay là ___.', a: ['robots.txt', 'robots'], why: 'Cache theo host 24 giờ; lỗi 5xx khi lấy file thì tạm không crawl host.' },
    { t: 'open', q: 'Mô tả cách crawler quyết định khi nào tải lại một trang để giữ index mới mà không lãng phí băng thông.', a: 'Mỗi trang có change_rate ước lượng từ lịch sử: mỗi lần tải so content_hash với lần trước; đổi thì rút ngắn khoảng recrawl, không đổi thì giãn gấp đôi tới trần vài tuần (adaptive như backoff). next_fetch_at lưu trong page_meta, scheduler đẩy URL đến hạn vào frontier với ưu tiên theo host authority và loại trang (tin tức cao hơn). Dùng conditional GET với If-Modified-Since và ETag để nhận 304 thay vì tải lại. Sitemap và lastmod của host là tín hiệu bổ sung. Lưu nhiều phiên bản HTML để đo thay đổi và re-index.', keys: ['change_rate', 'next_fetch_at', 'conditional', 'etag', 'adaptive'] }
  ]
},
{ id: 'C18', type: 'case', topic: 'queue', title: 'Case: Design a distributed job scheduler (cron as a service)', time: '120 phút',
  goal: 'Thiết kế được job scheduler phân tán không lỡ tick khi redeploy và không double-run: job store persist next_run_at, partition hoặc leader election, lease + heartbeat, at-least-once + idempotent, misfire policy, retry/backoff, DLQ, history; biết khi nào Postgres SKIP LOCKED là đủ.',
  md: `
## Đề bài
> "Design a distributed job scheduler, cron as a service: users define jobs with a cron expression or a one-off time, the system runs them on time at least once, survives node crashes and deployments, supports retries, and shows run history."

Dịch: Thiết kế job scheduler phân tán: người dùng định nghĩa job bằng cron expression hoặc thời điểm một lần, hệ thống chạy đúng giờ ít nhất một lần, sống sót khi node chết hoặc deploy, hỗ trợ retry, có lịch sử chạy. Thời gian 45 phút.

## 1. Làm rõ yêu cầu (5 phút)
- Hỏi: Job là gì về mặt thực thi: gọi HTTP webhook, chạy container, hay hàm nội bộ? → Đáp: gọi HTTP endpoint của người dùng và chạy worker nội bộ; thiết kế không phụ thuộc.
- Hỏi: Độ chính xác thời gian? → Đáp: chạy trong vòng 1 phút sau giờ hẹn là đạt; không cần mili giây.
- Hỏi: Nếu hệ thống down qua giờ chạy thì sao (misfire)? → Đáp: tuỳ job: chạy bù một lần, bỏ qua, hoặc chạy bù tất cả; người dùng chọn.
- Hỏi: Job có được chạy song song với chính nó không? → Đáp: mặc định không; lần trước chưa xong thì lần sau bỏ qua hoặc xếp hàng.
- Hỏi: Quy mô? → Đáp: 1 triệu job định nghĩa, trung bình 1 lần/giờ.
- Hỏi: Thời lượng job? → Đáp: vài giây đến 30 phút.

Chốt lại:
- **Functional**: CRUD job (cron, timezone, payload, retry policy, misfire policy, concurrency policy); chạy đúng giờ; retry với backoff; DLQ cho job hỏng; lịch sử và trạng thái từng run; pause/resume; trigger tay.
- **Non-functional**: at-least-once (không lỡ), **không double-run** trong điều kiện bình thường; không node nào là single point of failure; deploy không mất tick; độ trễ kích hoạt dưới 1 phút; 1 triệu job.
- **Ngoài phạm vi**: DAG phụ thuộc giữa job (Airflow), sandbox thực thi mã người dùng.

## 2. Ước lượng (5 phút)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Run trung bình | 10^6 job / 3 600 s | ~280 run/s |
| Đỉnh | cron hay đặt :00, 20% job trùng phút chẵn | 200k run trong 1 phút ≈ 3 300/s trong 60 giây |
| Ghi history | 24 triệu run/ngày × 500 B | ~12 GB/ngày, 30 ngày ≈ 360 GB |
| Bảng job | 10^6 × 1 KB | 1 GB, vừa RAM |
| Lease và heartbeat | 3 000 run đang chạy × heartbeat 10 s | 300 update/s, nhỏ |
| Queue | 3 300 msg/s đỉnh × 1 KB | 3 MB/s, nhỏ |

Kết luận: tải nhỏ với DB và queue; khó khăn là **tính đúng**: không lỡ, không chạy đúp, và xử lý burst phút chẵn bằng cách dàn (jitter) hoặc queue đệm.

## 3. Thiết kế tổng thể (10–12 phút)
:::diagram
User[User / API client] -> API[Scheduler API]
API -> JobDB[Job store Postgres jobs + runs]
Sched[Scheduler nodes partition theo job hash] -> JobDB : poll due SKIP LOCKED
Sched -> Queue[Queue RabbitMQ hoặc Kafka] : run message
Queue -> Worker[Worker pool]
Worker -> Target[HTTP endpoint hoặc hàm nội bộ]
Worker -> JobDB : lease heartbeat, kết quả
Worker -> DLQ[Dead letter queue] : hết retry
Coord[Coordinator lease table hoặc etcd] -> Sched : gán partition
Hist[History API / UI] -> JobDB
:::

**Luồng**: API ghi job với next_run_at tính từ cron và timezone. Scheduler node sở hữu một tập partition (job_id hash % 64) qua lease trong bảng coordinator; mỗi giây poll [[jobs WHERE partition IN (...) AND next_run_at <= now() FOR UPDATE SKIP LOCKED LIMIT 1000]], với mỗi job: tạo run (job_id, scheduled_at UNIQUE), publish message, cập nhật next_run_at = lần kế tiếp **từ scheduled_at**, tất cả trong một transaction. Worker nhận message, claim run bằng lease (lease_until), heartbeat 10 giây, thực thi, ghi kết quả; thất bại thì lên lịch retry với backoff; hết retry vào DLQ.

| Endpoint | Mô tả | Ghi chú |
|---|---|---|
| POST /v1/jobs | Tạo job | cron, tz, payload, retry, misfire, concurrency |
| PUT /v1/jobs/{id} hoặc pause/resume | Sửa, tạm dừng | tính lại next_run_at |
| POST /v1/jobs/{id}/trigger | Chạy tay | tạo run với scheduled_at = now |
| GET /v1/jobs/{id}/runs?limit | Lịch sử | trạng thái, thời lượng, lỗi |
| GET /v1/runs/{id} | Chi tiết một lần chạy | log tham chiếu |

Mô hình dữ liệu:
| Bảng | Key | Ghi chú |
|---|---|---|
| jobs | job_id | cron, timezone, payload, next_run_at, partition, status, retry_policy, misfire_policy, concurrency_policy, version |
| runs | run_id | job_id, scheduled_at, started_at, finished_at, status, attempt, worker_id, lease_until, error; UNIQUE (job_id, scheduled_at, attempt) |
| scheduler_leases | partition | owner_node, lease_until |
| dead_letters | run_id | payload, last_error, moved_at |

Index quan trọng: [[jobs (partition, next_run_at) WHERE status = active]] (partial) để poll là một range scan nhỏ; [[runs (job_id, scheduled_at DESC)]] cho lịch sử.

## 4. Đào sâu (15–18 phút)
### 4.1 Lưu lịch ở đâu: time wheel, sorted set hay DB index
| Phương án | Cách làm | Ưu | Nhược |
|---|---|---|---|
| In-memory timer (gocron, time wheel) | Mỗi node giữ timer trong RAM | Latency ms, đơn giản | Mất lịch khi restart, lỡ tick khi deploy, nhiều node chạy đúp |
| Redis sorted set score = next_run_at | ZRANGEBYSCORE lấy due | Nhanh, chia sẻ giữa node | Redis là điểm mất dữ liệu nếu không AOF; ZPOP không nguyên tử với publish |
| Postgres index next_run_at + SKIP LOCKED | Poll mỗi giây theo partition | Bền, transactional với tạo run, dễ query lịch sử | Poll latency 1 giây, DB chịu 280 đến 3 300 update/s |
| Time wheel phân cấp trong RAM + persist | Hiệu quả cho hàng triệu timer | O(1) thêm và bắn | Phức tạp, vẫn cần persist |

Chọn Postgres làm **nguồn sự thật** vì yêu cầu 1 phút và tải nhỏ; RAM chỉ làm cache. Hệ nhỏ dưới vài trăm run/giây thì **một bảng Postgres với SKIP LOCKED là đủ**, không cần Kafka: worker poll trực tiếp bảng runs. Đây là câu nên nói để chứng tỏ không over-engineer.
~~~sql
UPDATE jobs SET next_run_at = $next, version = version + 1
WHERE job_id IN (
  SELECT job_id FROM jobs
  WHERE partition = ANY($parts) AND status = 'active' AND next_run_at <= now()
  ORDER BY next_run_at LIMIT 1000
  FOR UPDATE SKIP LOCKED
) RETURNING job_id, next_run_at;
~~~

### 4.2 Không lỡ tick khi redeploy, không chạy đúp khi nhiều node
- **Lỡ tick** xảy ra khi lịch sống trong RAM của process và process bị thay thế đúng lúc (Watchtower redeploy 30 giây). Giải pháp: next_run_at **persist**, tính từ scheduled_at trước chứ không từ "lúc process khởi động"; node mới lên poll thấy next_run_at đã quá hạn thì chạy bù theo misfire policy.
- **Chạy đúp** xảy ra khi hai node cùng thấy job đến hạn. Giải pháp 1: **partition** job theo hash, mỗi partition có đúng một owner qua lease (lease_until, heartbeat, hết hạn thì node khác nhận). Giải pháp 2: **leader election** (etcd, ZooKeeper, hoặc Postgres advisory lock) chọn một scheduler duy nhất; đơn giản nhưng không scale ghi. Giải pháp 3: không cần owner, chỉ dựa vào SKIP LOCKED + UNIQUE (job_id, scheduled_at): hai node cùng poll, DB chỉ cho một bên lấy dòng. Chọn 3 cho hệ nhỏ, 1 khi cần scale.
| Cơ chế | Chống đúp | Chống lỡ | Ghi chú |
|---|---|---|---|
| gocron in-memory, 1 replica | Có (vì 1 replica) | Không | Redeploy là mất |
| Leader election + in-memory | Có | Không, trừ khi persist | Leader chết là mất lịch chưa persist |
| Partition lease + persist next_run_at | Có | Có | Cần bảng lease và heartbeat |
| SKIP LOCKED + UNIQUE run | Có | Có | Đơn giản nhất, phụ thuộc một DB |

### 4.3 Lease, heartbeat, at-least-once và idempotent
- Worker claim run: [[UPDATE runs SET worker_id=$w, lease_until=now()+60s WHERE run_id=$r AND status='queued']]; heartbeat gia hạn lease mỗi 10 giây; worker chết thì lease hết hạn và run được **requeue** (trạng thái về queued, attempt + 1).
- Vì thế một run có thể chạy hai lần (worker chết ngay sau khi xong nhưng chưa ghi kết quả): đây là at-least-once. Job phải **idempotent**: nhận run_id và scheduled_at làm key; ví dụ "gửi báo cáo ngày 2026-10-19" kiểm tra đã gửi chưa trước khi gửi.
- Concurrency policy: Forbid (lần trước chưa xong thì bỏ lần này, ghi run status skipped), Allow, Replace (huỷ lần trước). Kiểm tra bằng run đang active của job.
- Retry: exponential backoff với jitter (30 s, 1 phút, 2 phút... tối đa 5 lần), chỉ retry lỗi retryable (timeout, 5xx), ghi mỗi attempt là một dòng runs; hết retry → dead_letters, alert cho chủ job.

### 4.4 Misfire policy, burst phút chẵn và observability
- Misfire: node down từ 01:00 đến 03:00, job mỗi giờ. Fire-once: chạy một lần lúc 03:00 rồi lịch tiếp; Skip: bỏ qua, next từ 04:00; Fire-all: chạy bù 01:00 và 02:00 (hiếm khi muốn). Mặc định fire-once, ngưỡng misfire 5 phút.
- Burst: 20% job ở phút :00 tạo 3 300 run/giây trong 60 giây. Dàn bằng **jitter theo job_id** (0 đến 59 giây) khi người dùng cho phép, và queue đệm để worker tiêu dần; scheduler poll LIMIT 1000 mỗi vòng, nhiều vòng trong một giây.
- Observability bắt buộc: scheduler_lag_seconds = now − next_run_at nhỏ nhất đang quá hạn; runs_started_total theo partition (một partition về 0 là owner chết mà lease chưa hết); dlq_depth; alert absent khi không có run nào bắt đầu trong 5 phút dù có job đến hạn.

## 5. Trade-off & câu hỏi vặn (5 phút)
- *Why not just use Kubernetes CronJob or cloud scheduler?* → Nếu đủ thì dùng; bài này cho multi-tenant với history, retry policy, UI và 1 triệu job, vượt khả năng quản lý của CronJob.
- *Why poll the database every second instead of event-driven?* → Vì due time là tương lai, không có sự kiện nào xảy ra; poll theo index là 1 range scan rẻ; có thể dùng LISTEN/NOTIFY để đánh thức sớm khi job mới có next_run_at gần.
- *What if the clock on nodes drifts?* → Dùng now() của DB làm thời gian chuẩn khi poll; NTP trên node; không so sánh thời gian giữa node.
- *Exactly-once possible?* → Không với side effect bên ngoài; at-least-once + idempotent theo run_id là thực tế.
- *How do you deploy the scheduler without missing runs?* → Rolling: node mới nhận partition qua lease trước khi node cũ tắt; vì lịch persist, khoảng trống vài giây chỉ gây trễ chứ không lỡ.
- *Timezone and DST?* → Lưu cron theo timezone của người dùng, tính next_run_at bằng thư viện có DST; job 02:30 ngày đổi giờ phải có quy tắc rõ.
- *How to show the next 5 run times?* → Tính từ cron ngay trong API, không cần lưu.
- *One job takes 2 hours and blocks a worker?* → Timeout theo job, worker pool riêng cho job dài, hoặc chạy job dài trên hạ tầng khác (container) và worker chỉ theo dõi.

## 6. Người phỏng vấn chấm gì
| Tiêu chí | Câu trả lời yếu | Câu trả lời mạnh |
|---|---|---|
| Nguồn sự thật của lịch | Timer trong RAM | next_run_at persist, tính từ scheduled_at, misfire policy |
| Chống đúp | "Dùng lock" | Partition lease hoặc SKIP LOCKED + UNIQUE (job_id, scheduled_at) |
| Thực thi | Fire and forget | Lease + heartbeat + requeue, idempotent theo run_id, retry/backoff, DLQ |
| Quy mô hợp lý | Kafka + ZooKeeper cho 280 run/s | Nói rõ Postgres SKIP LOCKED đủ cho hệ nhỏ, đường mở rộng khi cần |
| Vận hành | Không có | scheduler lag, partition im lặng, DLQ depth, alert absent |

**Nói thế nào trong phỏng vấn (EN)**
- "The schedule must live in durable storage, not in process memory, otherwise every deploy risks a missed tick." — Lịch phải nằm trong lưu trữ bền, không trong RAM process.
- "I compute the next run from the previous scheduled time, so restarts never shift the schedule." — Tính lần kế tiếp từ giờ đã hẹn trước, restart không làm lệch lịch.
- "Duplicate runs are prevented by a unique key on job id and scheduled time, with SKIP LOCKED so nodes do not block each other." — Chống chạy đúp bằng UNIQUE (job, scheduled_at) và SKIP LOCKED.
- "Execution is at-least-once with leases and heartbeats, so jobs must be idempotent on the run id." — Thực thi at-least-once với lease và heartbeat, job phải idempotent theo run id.
- "At a few hundred runs per second a single Postgres table is enough; I would add Kafka only when the numbers say so." — Vài trăm run/giây thì một bảng Postgres là đủ.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Sự cố #9 là nguyên mẫu của bài này: gocron in-memory + Watchtower redeploy 30 giây = lỡ tick; không leader election = hai container cùng chạy khi rolling. Việc cần làm: bảng scheduled_jobs với next_run_at persist, worker poll bằng SKIP LOCKED, UNIQUE (job_name, scheduled_at) để không đúp.
- Last Scanned (ticket 2299) kẹt vì runner return sớm bỏ qua TouchAll: tách "run đã bắt đầu" và "run đã xong" thành dòng runs với status, Last Scanned lấy từ finished_at của run thành công gần nhất, không từ side effect cuối hàm.
- Ticket 3362: reconcile gate so finished_at với sync kết thúc giữa chừng; đây là bài misfire và concurrency policy Forbid: ghi scheduled_at và finished_at rõ ràng, reconcile chạy khi sync run gần nhất ở trạng thái succeeded.
- Lease + heartbeat cho sweeper và policy eval: job 17 phút trên project 90k component (sự cố #3) cần lease dài hơn hoặc heartbeat gia hạn, nếu không bị requeue và chạy đúp, tốn RAM gấp đôi.
- Observability: scheduler_lag_seconds và alert absent "không có run nào trong 2 chu kỳ" sẽ bắt sự cố #1 và #9 trong 10 phút thay vì nhiều ngày.
- Concurrency policy Forbid cho sweep và reconcile: run trước còn running (lease còn hạn) thì run mới ghi skipped thay vì chạy chồng, tránh hai sweeper cùng lấy pending của một tenant.
- Burst phút chẵn: 100 tenant cùng scheduled scan lúc 02:00 nên jitter theo tenant_id trong 0 đến 30 phút, giảm đỉnh trên Aurora và trên quota của nguồn ngoài.
- Việc tuần này: viết ADR "Scheduler persist trên Postgres thay gocron", migration bảng scheduled_jobs + job_runs, chuyển 1 job (scheduled scan) sang mô hình mới, test bằng docker restart giữa tick.
`,
  quiz: [
    { t: 'mc', q: 'Hệ dùng gocron in-memory, một replica, deploy bằng Watchtower. Job hằng ngày lúc 02:00 thỉnh thoảng không chạy. Nguyên nhân khả dĩ nhất?', o: ['Cron expression sai timezone', 'Postgres statement_timeout', 'Worker thiếu quyền', 'Lịch sống trong RAM process; redeploy đúng lúc tick làm mất tick và lịch tính lại từ lúc khởi động'], a: 3, why: 'Lịch không persist thì mọi restart là một khoảng mù; next_run_at phải lưu bền và tính từ scheduled_at.' },
    { t: 'mc', q: 'Hai scheduler node cùng poll bảng jobs. Cơ chế rẻ nhất để chỉ một node lấy được mỗi job đến hạn?', o: ['Mỗi node sleep ngẫu nhiên trước khi poll', 'SELECT ... FOR UPDATE SKIP LOCKED kết hợp UNIQUE (job_id, scheduled_at) cho run', 'Dùng ZooKeeper leader election cho mọi job', 'Chỉ chạy một node'], a: 1, why: 'DB làm trọng tài: dòng bị khoá bị node kia bỏ qua, UNIQUE chặn run trùng nếu lọt lưới.' },
    { t: 'mc', q: 'Worker chết sau khi job hoàn thành nhưng trước khi ghi kết quả. Lease hết hạn, run được requeue. Hậu quả và yêu cầu kéo theo?', o: ['Run chạy lần hai; job phải idempotent theo run_id', 'Run bị mất; cần exactly-once', 'DB bị khoá; cần tăng timeout', 'Không có hậu quả'], a: 0, why: 'Lease + requeue cho at-least-once; side effect bên ngoài phải tự kiểm tra đã làm chưa.' },
    { t: 'mc', q: 'Hệ thống down từ 01:00 đến 03:00, job chạy mỗi giờ với misfire policy fire-once. Khi lên lúc 03:00 chuyện gì xảy ra?', o: ['Chạy bù cả 01:00 và 02:00', 'Bỏ qua, lần kế tiếp 04:00', 'Chạy một lần ngay lúc 03:00 rồi lịch tiếp 04:00', 'Chờ người dùng xác nhận'], a: 2, why: 'Fire-once chạy bù một lần cho các tick bị lỡ; fire-all mới chạy từng tick; skip bỏ hẳn.' },
    { t: 'mc', q: '20% trong 1 triệu job đặt ở phút :00 tạo 3 300 run/giây trong 60 giây. Cách giảm đỉnh hợp lý?', o: ['Từ chối tạo job ở phút :00', 'Jitter theo job_id 0 đến 59 giây khi người dùng cho phép, cộng queue đệm cho worker', 'Tăng poll interval lên 5 phút', 'Chạy tất cả trong một transaction'], a: 1, why: 'Dàn đều tải theo thời gian; queue hấp thụ phần còn lại trong khi độ trễ vẫn dưới 1 phút.' },
    { t: 'fill', q: 'Điền: mệnh đề SQL của Postgres cho phép nhiều worker lấy dòng khác nhau mà không chờ nhau: FOR UPDATE ___.', a: ['skip locked'], why: 'SKIP LOCKED biến bảng thành queue đủ tốt cho vài trăm job/giây.' },
    { t: 'fill', q: 'Điền: chính sách quyết định làm gì với các lần chạy bị lỡ khi hệ thống down qua giờ hẹn gọi là ___ policy.', a: ['misfire'], why: 'Fire-once, skip, fire-all; mặc định fire-once với ngưỡng vài phút.' },
    { t: 'open', q: 'Trình bày thiết kế để scheduler vừa không lỡ tick khi rolling deploy vừa không chạy đúp khi có 3 node, và chỉ ra metric bạn sẽ đặt alert.', a: 'Lịch persist trong bảng jobs với next_run_at tính từ scheduled_at trước, không phụ thuộc thời điểm process khởi động; node mới lên poll thấy quá hạn thì xử lý theo misfire policy nên deploy chỉ gây trễ vài giây. Chống đúp bằng partition theo job hash với lease (owner, lease_until, heartbeat) hoặc đơn giản hơn là SKIP LOCKED khi poll cộng UNIQUE (job_id, scheduled_at) trên runs. Worker claim run bằng lease và heartbeat, hết lease thì requeue, job idempotent theo run_id. Alert: scheduler_lag_seconds vượt 60 giây, runs_started_total của một partition bằng 0 trong 5 phút dù có job đến hạn (alert absent), dlq_depth tăng, lease hết hạn nhiều.', keys: ['persist', 'skip locked', 'unique', 'lease', 'lag'] }
  ]
},
{ id: 'C19', type: 'case', topic: 'design', title: 'Case: Design an SBOM analysis platform (capstone)', time: '180 phút',
  goal: 'Thiết kế lại từ đầu hệ thống bạn đang làm như một bài phỏng vấn: multi-tenant upload SBOM lớn, component store dùng chung + overlay per-tenant, enrichment pipeline gọi API ngoài có politeness và isolate lỗi, sweeper công bằng, policy eval incremental với atomic swap, scheduler persist, outbox, observability và capacity; mỗi quyết định gắn với một sự cố thật.',
  md: `
## Đề bài
> "Design a multi-tenant SBOM analysis platform. Customers upload SBOM files in CycloneDX or SPDX format, some with up to 200 thousand components. The platform resolves components, enriches them with license and vulnerability data from external sources, evaluates customer policies, and notifies users. Assume 100 tenants, 1 000 targets, and 50 thousand components per target."

Dịch: Thiết kế nền tảng phân tích SBOM đa tenant. Khách upload file SBOM (CycloneDX hoặc SPDX), có file tới 200 nghìn component. Nền tảng chuẩn hoá component, làm giàu dữ liệu license và vulnerability từ nguồn ngoài, đánh giá policy của khách, và thông báo. Giả định 100 tenant, 1 000 target, 50 nghìn component mỗi target. Thời gian 45 phút (bài này viết dài hơn vì là capstone).

## 1. Làm rõ yêu cầu (5 phút)
- Hỏi: Tenant có chia sẻ dữ liệu gì với nhau không? → Đáp: dữ liệu **công khai** (vulnerability, license theo registry) dùng chung; dữ liệu tenant khai báo (license trong file của họ, ghi đè tay) là riêng.
- Hỏi: Nguồn ngoài nào, giới hạn gì? → Đáp: ClearlyDefined cho license (batch 100 coordinate), OSV, NVD, GHSA cho vulnerability; mỗi nguồn có rate limit và đôi khi chậm hoặc lỗi.
- Hỏi: SLA sau upload? → Đáp: danh sách component thấy trong 1 phút; license và vulnerability "đa số" trong 15 phút; hoàn tất trong 1 giờ.
- Hỏi: Policy là gì? → Đáp: rule theo license, severity, EOL... áp lên component của target; kết quả là danh sách violation phục vụ audit, phải **không mất** và không nháy.
- Hỏi: Scheduled scan? → Đáp: feed vulnerability đồng bộ hằng ngày, re-match toàn bộ component, policy re-eval, thông báo thay đổi.
- Hỏi: Tenant lớn nhất? → Đáp: một tenant có thể có target 200k component stress test; không được làm chậm tenant khác.

Chốt lại:
- **Functional**: upload và parse; component store; enrichment license + vulnerability; policy eval và violation; scheduled re-scan; notification và audit log; dashboard tổng hợp; export.
- **Non-functional**: tenant isolation (dữ liệu và tài nguyên); đúng về license per-tenant; không mất violation; pipeline hồi phục được sau lỗi nguồn ngoài; quan sát được "đang kẹt"; chi phí vận hành thấp cho đội nhỏ.
- **Ngoài phạm vi**: tạo SBOM từ mã nguồn, VEX workflow đầy đủ, billing.

## 2. Ước lượng (5 phút)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Component-row theo tenant | 1 000 target × 50k | 50 triệu dòng liên kết (target, component) |
| Component duy nhất toàn hệ | giả định trùng 10 lần giữa target | ~5 triệu component duy nhất |
| Upload mỗi ngày | 1 000 target × 1 lần | 1 000 upload, 50 triệu dòng ghi/ngày ≈ 600 dòng/s trung bình |
| Đỉnh một upload | 50k dòng cần hiện trong 1 phút | ~850 dòng/s cho một upload; 200k component file ≈ 200 MB JSON |
| Enrichment lần đầu | 5 triệu coordinate / 100 mỗi batch | 50k request ClearlyDefined; ở 10 req/s ≈ 1,4 giờ |
| Re-match vulnerability hằng ngày | 5 triệu component × tra feed | vài triệu lookup, phải theo batch và index |
| Policy eval | 100 tenant × 10 policy × 50k component × 10 target | 5 tỷ phép so sánh nếu one-shot; incremental chỉ phần đổi |
| Bảng violation | giả định 2% component vi phạm × 10 policy | ~10 triệu dòng (thực tế 9,6 triệu) |
| RAM nếu preload | 50k component × 10 vulnerability × 1 KB | 500 MB mỗi project; 200k component ≈ 2 GB, ×10 goroutine = OOM |

Kết luận cần nói: ghi không lớn, nhưng **enrichment là I/O ngoài giới hạn bởi rate limit** và **policy eval là CPU và DB** nếu làm one-shot. Thiết kế phải incremental và theo batch có kiểm soát.

## 3. Thiết kế tổng thể (10–12 phút)
:::diagram
FE[Next.js FE] -> API[API server Go]
API -> S3[Object storage file SBOM]
API -> DB[Postgres tenant schema + shared]
API -> MQ[RabbitMQ]
MQ -> Parser[Parser worker streaming]
Parser -> DB : component + link theo batch 1000
Parser -> Enrich[Enrichment coordinator]
Enrich -> Redis[Redis L1 cache + rate limiter]
Enrich -> Lambda[Lambda batch fetchers]
Lambda -> Ext[ClearlyDefined / OSV / NVD / GHSA]
Sweeper[Sweeper fair theo tenant] -> Enrich
Policy[Policy evaluator incremental] -> DB
Sched[Scheduler persist + lease] -> MQ
Outbox[Outbox relay] -> MQ : notification, audit
Obs[Prometheus + Alertmanager] -> API
:::

**Luồng upload**: FE upload file lên S3 qua presigned URL → API tạo import job (idempotency key = sha256 file + target) → publish qua outbox → parser worker **stream** JSON (không ReadAll), chuẩn hoá purl, upsert component vào bảng dùng chung theo batch 1 000, ghi link (tenant, target, revision, component) và dòng trạng thái enrichment pending → coordinator gom coordinate chưa có trong cache thành batch theo nguồn → Lambda gọi API ngoài với rate limiter theo host → ghi kết quả vào bảng kết quả dùng chung và overlay tenant → policy evaluator tính incremental cho revision mới → violation swap → outbox phát notification.

| Endpoint | Mô tả | Ghi chú |
|---|---|---|
| POST /v1/targets/{id}/sboms | Lấy presigned URL và tạo import | Idempotency-Key = sha256 file |
| GET /v1/imports/{id} | Trạng thái import, tiến độ enrichment | đếm theo status |
| GET /v1/targets/{id}/components?cursor | Danh sách component với license, vuln | keyset pagination, read replica |
| GET /v1/policies/{id}/violations?cursor | Violation hiện hành | đọc bản active của eval run |
| POST /v1/components/{id}/license-override | Ghi đè license theo tenant | ghi vào overlay |
| GET /v1/exports/{id} | Export stream | job nền, file ở S3 |

Mô hình dữ liệu:
| Bảng | Key | Ghi chú |
|---|---|---|
| components (shared) | component_id = hash(purl chuẩn hoá) | purl, name, version; không chứa gì tenant-specific |
| component_enrichment (shared) | (component_id, source) | status pending/enriched/failed/no_locator, attempts, next_attempt_at, last_error, data |
| tenant_component_overlay | (tenant_id, component_id) | declared_license, override_license, note; **đọc trước shared** |
| target_revision_components | (tenant_id, target_id, revision_id, component_id) | partition theo tenant_id |
| vulnerabilities (shared) | vuln_id | từ feed, re-sync hằng ngày; component_vulnerabilities (component_id, vuln_id) |
| policy_eval_runs | run_id | tenant_id, policy_id, target_id, revision_id, status, started_at, finished_at |
| policy_violations | (run_id, component_id, rule_id) | partition theo tenant_id; bảng con trỏ active_run (policy_id, target_id) → run_id |
| outbox | event_id | aggregate, payload, created_at, sent_at |
| scheduled_jobs, job_runs | job_id, run_id | next_run_at persist, UNIQUE (job_id, scheduled_at) |

## 4. Đào sâu (15–18 phút)
### 4.1 Dữ liệu dùng chung với overlay per-tenant (sự cố #15)
Vấn đề: license của một purl là dữ liệu công khai nên dùng chung tiết kiệm 10 lần; nhưng license **khai báo trong file của tenant A** không được hiện cho tenant B. Mô hình "first-writer-wins" vào bảng chung làm leak.
| Phương án | Ưu | Nhược |
|---|---|---|
| Mọi thứ per-tenant | Cách ly tuyệt đối | Enrichment 100 lần cho cùng purl, cache vô dụng |
| Mọi thứ shared, first-writer-wins | Rẻ | Leak dữ liệu tenant, không biết nguồn |
| Shared cho dữ liệu công khai + overlay per-tenant | Rẻ và đúng | Mọi đường đọc phải merge 2 lớp, dễ quên |
Chọn phương án 3 với quy tắc cứng: bảng shared chỉ nhận dữ liệu có **nguồn công khai** (ClearlyDefined, feed); dữ liệu từ file của tenant hoặc ghi đè tay vào overlay; một hàm resolveLicense(tenant, component) duy nhất merge theo thứ tự override → declared (overlay) → enriched (shared) → unknown, dùng ở mọi view và export. Test: cùng purl ở 2 tenant với declared khác nhau phải ra khác nhau.

### 4.2 Enrichment pipeline: batch, politeness, isolate lỗi, status machine, sweeper công bằng (sự cố #2, #7, #8, #16)
- **Batch theo nguồn** với kích thước nguồn cho phép (ClearlyDefined 100); rate limiter theo host trong Redis (token bucket, ví dụ 10 req/s); 429 hoặc 503 thì backoff theo host, không phải theo item.
- **Isolate lỗi per item**: validate coordinate trước khi vào batch (version-range, thiếu purl → no_locator ngay, không gọi API); lỗi batch thì chia đôi và thử lại (bisect) để tìm item hỏng, item đó failed với last_error, 99 item còn lại enriched. FetchBatch **phải trả lỗi**, không nuốt.
- **Status machine** đi tới: pending → enriched, hoặc failed (attempts, next_attempt_at backoff 1 giờ, 4 giờ, 1 ngày, trần 5 lần → failed vĩnh viễn có lý do), hoặc no_locator. UPDATE luôn có WHERE status cũ.
- **Sweeper công bằng**: thay vì "100 pending cũ nhất" (zombie chiếm chỗ, query 54 đến 489 giây), sweeper lặp theo **tenant round-robin**, mỗi tenant lấy tối đa N dòng [[WHERE status='pending' AND next_attempt_at <= now()]] qua partial index [[(tenant_id, next_attempt_at) WHERE status='pending']]; budget thời gian chia đều; dòng lỗi có next_attempt_at xa nên không chặn.
- **Cache L1 Redis** cho (source, coordinate) → kết quả, TTL 7 ngày; Lambda phải nhận cấu hình Redis và RabbitMQ qua **config kiểm tra lúc khởi động** (fail fast nếu thiếu env, không fallback localhost).
| Cách lấy dòng pending | Hành vi khi có zombie | Thời gian query |
|---|---|---|
| ORDER BY created_at LIMIT 100 toàn bảng | Zombie chiếm 100 chỗ mãi | Phút trên 700k dòng không index phù hợp |
| Theo next_attempt_at có backoff, partial index | Zombie lùi ra sau | ms |
| Round-robin theo tenant + partial index | Công bằng, một tenant lớn không chặn | ms mỗi tenant |

### 4.3 Policy evaluation incremental và atomic swap (sự cố #6, #14)
Vấn đề: eval one-shot "xoá violation cũ rồi ghi mới" làm lần eval lỗi hoặc trả 0 kết quả **xoá sạch** kết quả tốt trước đó; 238 policy chạy liên tục trên bảng 9,6 triệu dòng chỉ có PK ghim DB.
- Mỗi lần eval là một **run** có run_id; violation ghi kèm run_id vào partition của tenant; khi run **succeeded và đủ điều kiện** (số component đã eval = số component của revision), cập nhật con trỏ active_run (policy_id, target_id) → run_id trong một UPDATE. Run lỗi hoặc thiếu dữ liệu không bao giờ đụng con trỏ. Dọn run cũ bằng job riêng sau 7 ngày.
- **Incremental**: eval chỉ khi có thay đổi đầu vào: revision mới, policy đổi, hoặc enrichment đổi cho component thuộc target (diff theo component_id). Event "component_enriched" gom theo target mỗi 5 phút rồi eval phần đổi; snapshot kết quả cũ cộng delta.
- Capacity: partition policy_violations theo tenant_id (LIST), index (run_id, rule_id), (tenant_id, target_id, component_id); truy vấn audit luôn qua active_run nên chỉ chạm một run.
| Mô hình violation | Mất dữ liệu khi eval lỗi | Nháy trong lúc eval | Chi phí |
|---|---|---|---|
| Xoá rồi ghi (one-shot) | Có | Có, bảng trống vài giây đến phút | Thấp |
| Diff theo policy, xoá mềm phần không còn | Có nếu lần eval trả thiếu | Ít | Trung bình |
| Run_id + con trỏ active swap | Không | Không | Thêm bảng run và job dọn |

### 4.4 Scheduler, outbox, observability và memory bound (sự cố #1, #3, #9, #12)
- **Scheduler**: scheduled_jobs với next_run_at persist, poll SKIP LOCKED, UNIQUE (job_id, scheduled_at), lease + heartbeat cho job dài; Watchtower redeploy chỉ gây trễ vài giây. Scheduled scan là một job với concurrency policy Forbid.
- **Outbox**: audit log và notification ghi vào bảng outbox trong cùng transaction với dữ liệu; relay publish sau commit, đánh dấu sent_at; consumer không bao giờ thấy event trước dữ liệu. Publisher RabbitMQ có reconnect loop và metric publish_errors_total; mất kết nối thì relay dừng và backlog outbox tăng (metric outbox_unsent).
- **Observability "no success in N minutes"**: counter enrichment_success_total theo nguồn, policy_runs_succeeded_total, job_runs_started_total theo job; alert absent 15 phút; metric pending_age_max_seconds; dead man switch cho Alertmanager.
- **Memory bound**: worker không bao giờ Preload toàn bộ; đọc theo keyset pagination 1 000 component, join vulnerability theo batch id, goroutine pool giới hạn 4 với semaphore, container có memory limit và GOMEMLIMIT; export stream ra S3 thay vì ReadAll.
- **FDW và migration**: schema remote qua FDW đóng băng; mỗi migration thêm cột phải kèm bước refresh foreign table trong runbook; không chạy migrate trên môi trường có alias.

## 5. Trade-off & câu hỏi vặn (5 phút)
- *Why share data across tenants at all?* → Vì vulnerability và license theo purl là sự thật công khai; chia sẻ giảm enrichment 10 lần. Ranh giới: chỉ dữ liệu có nguồn công khai, còn lại overlay.
- *Why Lambda for enrichment instead of the worker?* → Burst 50k request khi upload lớn, scale về 0 khi rảnh; đổi lại phải quản lý env, cold start, và không có state cục bộ nên cache phải ở Redis.
- *How do you keep one tenant from starving others?* → Round-robin theo tenant trong sweeper, rate limiter theo nguồn chia quota, queue theo tenant hash, limit component mỗi upload (từ chối hoặc hàng chờ riêng cho 200k).
- *Why not evaluate policies synchronously on upload?* → 50k component × 10 policy trong request là quá lâu; eval nền theo run và con trỏ active cho phép người dùng thấy kết quả cũ cho tới khi mới sẵn sàng.
- *What is your consistency model for license?* → Overlay đọc trước shared; Target Details là sự thật (PRCL), dashboard tổng hợp là snapshot có thể trễ vài phút và có cờ cập nhật.
- *How do you know enrichment is stuck?* → pending_age_max và tỉ lệ success theo nguồn; alert absent 15 phút; dashboard per tenant.
- *How would you handle a 200 thousand component upload?* → Stream parse, batch 1 000, hàng chờ riêng, ước lượng 200k / 850 mỗi giây ≈ 4 phút chỉ cho ghi; thông báo tiến độ.
- *Postgres or something else for 50 million link rows?* → Postgres với partition theo tenant và index đúng là đủ; cân nhắc ClickHouse cho dashboard tổng hợp nếu truy vấn phân tích tăng.
- *What would you cut for an MVP?* → Lambda (chạy fetch trong worker với rate limiter), Elasticsearch (dùng Postgres full text), giữ outbox, status machine và scheduler persist vì chúng là correctness.

## 6. Người phỏng vấn chấm gì
| Tiêu chí | Câu trả lời yếu | Câu trả lời mạnh |
|---|---|---|
| Multi-tenant | Một cột tenant_id là xong | Phân biệt dữ liệu công khai dùng chung và overlay per-tenant, hàm resolve duy nhất |
| Pipeline ngoài | Gọi API trong vòng lặp | Batch theo nguồn, rate limiter theo host, isolate per item, status machine có backoff, cache L1 |
| Fairness | FIFO | Round-robin tenant, partial index, budget chia đều, zombie lùi ra sau |
| Correctness của kết quả dẫn xuất | Xoá rồi ghi | Run_id + con trỏ active swap, incremental theo diff |
| Vận hành | Không có | Scheduler persist, outbox, alert absent, memory limit, runbook FDW |
| Gắn với thực tế | Lý thuyết | Mỗi quyết định có một sự cố thật làm bằng chứng |

**Nói thế nào trong phỏng vấn (EN)**
- "Public facts like vulnerabilities are shared across tenants; anything a tenant declares lives in a per-tenant overlay, and a single resolver merges them." — Sự thật công khai dùng chung, khai báo của tenant nằm ở overlay, một resolver duy nhất merge.
- "External enrichment is a politeness problem: batch per source, rate limit per host, isolate failures per item, and never swallow a batch error." — Enrichment là bài politeness: batch theo nguồn, rate limit theo host, cô lập lỗi theo item.
- "Derived results are written under a run id and published by swapping a pointer, so a failed run can never erase good data." — Kết quả dẫn xuất ghi theo run id và công bố bằng đổi con trỏ.
- "The sweeper is round-robin by tenant with a partial index on pending rows, so one noisy tenant cannot starve the rest." — Sweeper round-robin theo tenant với partial index.
- "Schedules persist in Postgres, events go through an outbox, and an absent alert tells us within fifteen minutes if anything silently stops." — Lịch persist, event qua outbox, alert absent báo trong 15 phút.
- "Workers are memory bounded by design: keyset pagination, batched joins, a small goroutine pool and a container limit." — Worker bị chặn bộ nhớ từ thiết kế.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
Đây chính là hệ thống của bạn, nên phần áp dụng là danh sách ADR và việc đo được trong 4 tuần, theo thứ tự rủi ro:
- Tuần 1 (correctness, sự cố #14, #12): ADR "Policy violation theo run_id + con trỏ active"; migration thêm policy_eval_runs và active_run; viết job dọn run cũ. ADR "Outbox cho audit và notification"; relay với reconnect loop.
- Tuần 2 (pipeline, sự cố #7, #8, #16): ADR "Enrichment status machine và sweeper round-robin tenant"; đưa partial index idx_prcl_pending vào migration chính thức; FetchBatch trả lỗi, bisect batch khi lỗi; validate coordinate trước khi gọi API, no_locator ngay.
- Tuần 3 (vận hành, sự cố #1, #2, #9): ADR "Scheduler persist trên Postgres thay gocron"; chuyển scheduled scan sang bảng scheduled_jobs; Lambda fail fast khi thiếu env; alert absent cho enrichment_success_total, job_runs_started_total, publish_errors_total.
- Tuần 4 (capacity, sự cố #3, #6, #11): partition policy_violations theo tenant_id và index (tenant_id, target_id, component_id); worker keyset pagination + GOMEMLIMIT + memory limit container; export stream ra S3.
- Mỗi ADR một trang: bối cảnh (sự cố số mấy, số liệu), quyết định, hệ quả, cách đo. Mang 4 ADR này vào phỏng vấn như câu chuyện "I redesigned the pipeline after these incidents".
- Mỗi tuần một buổi 30 phút review metric tuần trước cùng team; ADR nào chưa có số đo thì chưa được đóng.
- Soạn bản trình bày 3 phút bằng tiếng Anh về kiến trúc này (bối cảnh, 4 quyết định, số đo) để dùng cả trong phỏng vấn lẫn khi họp với khách.
- Số đo thành công: pending_age_max dưới 15 phút ở p95; không có violation mồ côi sau 30 ngày; RAM worker dưới 1 GiB trên project 90k component; không lỡ tick scheduled scan trong 30 ngày.
`,
  quiz: [
    { t: 'mc', q: 'Tenant A upload SBOM khai báo license MIT cho purl X; tenant B thấy MIT cho X dù file của B không khai báo. Lỗi thiết kế?', o: ['Dữ liệu tenant khai báo ghi vào bảng dùng chung kiểu first-writer-wins; cần overlay per-tenant', 'Thiếu index trên bảng license', 'Cache Redis không có TTL', 'Parser SPDX sai'], a: 0, why: 'Bảng shared chỉ được nhận dữ liệu có nguồn công khai; khai báo của tenant nằm ở overlay, resolver merge theo thứ tự.' },
    { t: 'mc', q: 'Một coordinate version-range làm API ngoài trả lỗi cho cả batch 100, và hàm FetchBatch nuốt lỗi. Hậu quả và sửa?', o: ['Chỉ item đó failed; không cần sửa', 'Cả 100 item failed vĩnh viễn; sửa bằng validate trước, bisect batch khi lỗi, FetchBatch trả lỗi', 'DB bị khoá; tăng timeout', 'Lambda hết bộ nhớ; tăng RAM'], a: 1, why: 'Lỗi phải cô lập per item; nuốt lỗi biến một item xấu thành hàng nghìn dòng failed không truy vết được.' },
    { t: 'mc', q: 'Sweeper lấy "100 dòng pending cũ nhất" và nhiều giờ xử lý 0 dòng. Nguyên nhân kết hợp khả dĩ nhất?', o: ['RabbitMQ đầy', 'Lambda cold start', 'Tenant xoá target', 'Zombie lỗi chiếm 100 chỗ mãi và query ListAllPending không có index phù hợp chạy quá budget'], a: 3, why: 'Cần next_attempt_at backoff, partial index trên pending và round-robin theo tenant.' },
    { t: 'mc', q: 'Policy eval lần N trả 0 kết quả do lỗi tạm thời và hệ thống xoá mềm toàn bộ violation của lần N−1. Thiết kế nào ngăn điều này?', o: ['Chạy eval ít hơn', 'Thêm index trên violation', 'Ghi violation theo run_id và chỉ đổi con trỏ active khi run succeeded và đủ điều kiện', 'Dùng xoá cứng thay xoá mềm'], a: 2, why: 'Run lỗi không bao giờ đụng con trỏ; dữ liệu tốt vẫn hiển thị cho tới khi run tốt hơn thay thế.' },
    { t: 'mc', q: 'Worker OOM 5 GiB khi eval project 90k component. Thay đổi nào đúng bản chất nhất?', o: ['Tăng RAM máy lên 16 GiB', 'Giảm số policy', 'Keyset pagination 1 000 component, join vulnerability theo batch, goroutine pool giới hạn, memory limit container', 'Chuyển sang MongoDB'], a: 2, why: 'Preload toàn bộ nhân với goroutine song song là nguyên nhân; bound bộ nhớ theo thiết kế, không theo máy.' },
    { t: 'fill', q: 'Điền: lớp dữ liệu riêng từng tenant đặt chồng lên bảng dùng chung, đọc trước khi fallback về shared, gọi là ___ per-tenant.', a: ['overlay'], why: 'Overlay giữ license declared và override của tenant; shared chỉ chứa sự thật công khai.' },
    { t: 'fill', q: 'Điền: mẫu ghi event vào bảng trong cùng transaction với dữ liệu rồi relay publish sau commit gọi là transactional ___.', a: ['outbox'], why: 'Outbox ngăn consumer nhận event trước khi dữ liệu tồn tại (FK violation, mất audit log).' },
    { t: 'open', q: 'Người phỏng vấn hỏi: làm sao biết pipeline enrichment đang kẹt trong 15 phút thay vì nhiều ngày, và tenant lớn không làm tenant nhỏ chết đói? Trình bày.', a: 'Observability: counter enrichment_success_total theo nguồn và tenant, alert absent khi không tăng trong 15 phút dù pending lớn hơn 0; gauge pending_age_max_seconds với ngưỡng 15 phút; publish_errors_total và outbox_unsent cho đường event; dead man switch cho Alertmanager. Fairness: sweeper round-robin theo tenant với partial index (tenant_id, next_attempt_at) WHERE status pending, mỗi tenant tối đa N dòng mỗi vòng, budget thời gian chia đều; rate limiter theo nguồn chia quota giữa tenant; queue theo tenant hash để upload 200k component vào hàng chờ riêng; item lỗi có next_attempt_at backoff nên không chiếm chỗ. Dashboard per tenant để thấy ai đang chiếm.', keys: ['absent', 'pending_age', 'round-robin', 'partial index', 'rate limit'] }
  ]
}
];

/* ===== Đề mock M11–M19, tham chiếu lời giải ở bài case C11–C19 ===== */
window.MOCKS = window.MOCKS || [];
window.MOCKS.push({
  id: 'M11', caseId: 'C11', title: 'Design a payment system', level: 3,
  prompt: "Design a payment system for an e-commerce platform. Customers pay through a third-party PSP such as Stripe, the platform records every money movement, and merchants get paid out. Money must never be lost, duplicated, or charged twice.\nDịch: Thiết kế hệ thống thanh toán cho sàn thương mại điện tử: khách trả qua PSP như Stripe, hệ thống ghi mọi chuyển động tiền, trả tiền cho merchant. Tiền không được mất, nhân đôi, hay charge hai lần.",
  clarify: [
    "Hỏi: Do we process cards ourselves or through a PSP? → Đáp: through a PSP; no card data stored, PCI handled by the PSP.",
    "Hỏi: Pay-in only, or also pay-out to merchants? → Đáp: both; pay-outs are batched daily.",
    "Hỏi: What volume? → Đáp: about one million transactions per day.",
    "Hỏi: Do we need an internal wallet or balance for merchants? → Đáp: yes, merchants see balance and history.",
    "Hỏi: What happens when the PSP is down? → Đáp: decline payments; never assume a payment succeeded.",
    "Hỏi: Multiple currencies? → Đáp: yes, but no real-time FX conversion.",
    "Hỏi: Is fraud detection in scope? → Đáp: no, only a hook for it."
  ],
  phases: {
    req: { checks: ['Nêu rõ PSP xử lý thẻ, mình không lưu thẻ', 'Chốt pay-in và pay-out, wallet merchant', 'Nói ra correctness quan trọng hơn availability', 'Liệt kê ngoài phạm vi: fraud, FX, PCI'], hint: `
- Hỏi về PSP trước: nó quyết định mình không chạm thẻ.
- Hỏi về hành vi khi PSP lỗi: câu trả lời "từ chối" cho phép chọn consistency.
- Chốt functional 5 gạch: tạo payment, thu qua PSP, ledger, trạng thái, pay-out, đối soát.
` },
    est: { checks: ['Ra ~10 TPS trung bình, ~100 TPS đỉnh', 'Ra ~7 dòng mỗi giao dịch và ~2 GB/ngày', 'Kết luận: không phải bài throughput, là bài correctness'], hint: `
- 10^6 giao dịch / 10^5 giây = 10 TPS.
- Mỗi giao dịch: 1 order, ~2 event, ~4 ledger entry.
- Nói to kết luận: Postgres đơn đủ, đừng vẽ sharding.
` },
    hld: { checks: ['Sơ đồ có Payment service, PSP, webhook handler, ledger, wallet, reconciliation', 'API POST /payments có Idempotency-Key', 'Mô hình dữ liệu: payment_order, payment_event, ledger_entry append-only, account', 'Tiền là BIGINT minor unit + currency'], hint: `
- Luồng: tạo order CREATED → gọi PSP với idempotency key = order id → webhook → SUCCEEDED → ledger + wallet.
- ledger_entry chỉ INSERT; account có snapshot_balance.
- Webhook handler làm ít: verify, insert event, 200, enqueue.
` },
    deep: { checks: ['Idempotency ở từng hop: client→mình, mình→PSP, PSP→mình', 'Ledger double-entry, bất biến tổng DEBIT = CREDIT, bút toán đảo', 'Webhook trùng, sai thứ tự, mất: state machine đi tới, poll, reconciliation hằng ngày', 'Saga cho wallet và pay-out, hoặc gộp chung DB nếu được'], hint: `
- Bảng 3 phương án exactly-once: at-most-once, at-least-once + idempotent, 2PC.
- Chỉ retry lỗi retryable; card_declined không retry.
- Order PROCESSING quá 15 phút thì poll PSP.
- Reconciliation với settlement report là lưới an toàn cuối.
` },
    wrap: { checks: ['Giải thích vì sao consistency thắng availability ở đây', 'Nêu metric: order kẹt, mismatch, webhook lỗi', 'Nói được một thứ sẽ làm khác nếu có thêm thời gian'], hint: `
- Câu kết: từ chối giao dịch rẻ hơn charge đúp.
- Nhắc 24 giờ cho idempotency key.
- Nhắc snapshot balance khi ledger lớn.
` }
  },
  followups: [
    "Why do you prefer consistency over availability for this system?",
    "How long do you keep idempotency keys and what happens after they expire?",
    "Two requests with the same idempotency key arrive at the same moment. What happens?",
    "Why not store money as a float or decimal?",
    "A webhook arrives before the transaction that created the order commits. How do you handle it?",
    "How would you detect that the system is silently losing money?",
    "How do you compute a balance when the ledger has billions of rows?",
    "Would you use a saga or a single database for payment and ledger, and why?"
  ],
  rubric_notes: `
- Câu trả lời mạnh mở đầu bằng nhận định: 100 TPS là nhỏ, bài này về correctness; sau đó dành thời gian cho idempotency, ledger, reconciliation.
- Idempotency phải được chỉ ra ở **từng hop** với cơ chế cụ thể (UNIQUE constraint, header của Stripe, psp_event_id), không chỉ nói tên pattern.
- Ledger: double-entry, append-only, tổng DEBIT = CREDIT, sửa sai bằng bút toán đảo, snapshot để tính balance.
- Bẫy thường gặp: tin webhook tuyệt đối; retry mọi lỗi kể cả card_declined; dùng float; vẽ sharding cho 100 TPS; quên reconciliation.
- Dấu hiệu senior: nói về state machine chỉ đi tới với UPDATE có điều kiện; phân loại lỗi retryable; metric cho order kẹt và mismatch; chọn gộp Payment + Ledger chung DB vì đơn giản hơn saga.
- Dấu hiệu junior: nói "dùng Kafka cho exactly-once" mà không giải thích sink idempotent; nói "dùng transaction phân tán với Stripe".
- Trả lời follow-up về idempotency key đồng thời phải nêu được UNIQUE làm trọng tài và trả 409 hoặc chờ.
- Nếu còn thời gian, người mạnh nhắc tới PCI scope, dead-letter cho webhook lỗi, và báo cáo đối soát cho kế toán.
`
});
window.MOCKS.push({
  id: 'M12', caseId: 'C12', title: 'Design a metrics monitoring and alerting system', level: 2,
  prompt: "Design a metrics monitoring and alerting system for a company that runs about 100 thousand servers. Engineers must be able to query and visualize metrics, define alert rules, and get notified when something goes wrong.\nDịch: Thiết kế hệ thống giám sát metric và cảnh báo cho công ty có khoảng 100 nghìn máy chủ: truy vấn và vẽ metric, định nghĩa alert rule, nhận thông báo khi có sự cố.",
  clarify: [
    "Hỏi: Metrics only, or also logs and traces? → Đáp: numeric time series only.",
    "Hỏi: How many metrics per host and how often do we collect? → Đáp: about 100 per host, every 10 seconds.",
    "Hỏi: Retention? → Đáp: raw for 7 days, 1-minute resolution for 30 days, 1-hour for a year.",
    "Hỏi: What query patterns? → Đáp: dashboards with aggregation over time windows and group by labels; alert rules evaluated periodically.",
    "Hỏi: Acceptable latency from collection to visibility? → Đáp: under one minute.",
    "Hỏi: Can we lose some data points? → Đáp: a few lost points are fine; a silent alerting pipeline is not.",
    "Hỏi: Multi-tenant or billing? → Đáp: no."
  ],
  phases: {
    req: { checks: ['Chốt chỉ metric số, không log/trace', 'Hỏi được scrape interval và retention theo tier', 'Phân biệt yêu cầu dashboard và yêu cầu alert', 'Nói ra: mất vài điểm được, alert im lặng thì không'], hint: `
- Hỏi đơn vị: series hay data point, interval bao nhiêu.
- Hỏi retention để sau tính tier hot/cold.
- Ghi non-functional: 1 triệu điểm/giây, query dưới 2 giây.
` },
    est: { checks: ['Ra 10 triệu series và 1 triệu điểm/giây', 'Ra ~1,4 TB/ngày raw và ~120 GB/ngày sau nén', 'Ra dung lượng mỗi tier downsample', 'Nhận xét: cardinality quyết định RAM'], hint: `
- 100k máy × 100 metric = 10M series; / 10 s = 1M điểm/s.
- 16 B mỗi điểm thô; Gorilla ~1,4 B.
- 1 phút × 30 ngày: 10M × 1440 × 30 × 2 B.
` },
    hld: { checks: ['Sơ đồ: agent → collector → Kafka → ingest → TSDB hot → cold; query service; alert manager; notify', 'Giải thích vì sao có Kafka ở giữa', 'Mô hình dữ liệu: series id, chunk, block, inverted index, alert_state', 'API query có start, end, step'], hint: `
- Collector pull theo service discovery + push gateway cho job ngắn.
- Partition Kafka theo hash series.
- Query service chọn tier theo khoảng thời gian.
` },
    deep: { checks: ['Bảng push vs pull và lựa chọn có lý do', 'Cardinality, nén Gorilla, chunk, downsample giữ sum và count', 'Alert manager: for, grouping, silence, inhibition, route, absent alert, state persist', 'Hot/cold query và cache theo bucket'], hint: `
- Label chỉ cho giá trị hữu hạn; user_id là thảm hoạ.
- avg của avg sai; giữ sum, count, min, max.
- Absent alert bắt được thứ im lặng dừng.
- Alert state phải persist để restart không gửi lại.
` },
    wrap: { checks: ['Dead man switch cho chính hệ giám sát', 'Giới hạn cardinality ở collector', 'Nêu điều sẽ làm khác với ngân sách khác'], hint: `
- Hệ giám sát phải tự giám sát.
- Nhắc Prometheus + Thanos/Cortex như hiện thực có sẵn.
- Nếu quy mô nhỏ hơn 100 lần: một Prometheus là đủ.
` }
  },
  followups: [
    "Why put Kafka between collection and storage? Does it not add latency?",
    "What happens if the alert manager itself goes down?",
    "How do you prevent cardinality explosions from a careless engineer?",
    "Why keep sum and count when downsampling instead of just the average?",
    "Push or pull for short-lived serverless functions?",
    "How do you alert on something that stopped happening rather than something that happened?",
    "How would a query spanning hot and cold storage work?",
    "When would a single Prometheus be enough?"
  ],
  rubric_notes: `
- Câu trả lời mạnh chốt đơn vị trước (series, điểm, interval) và ra 1 triệu điểm/giây trước khi vẽ gì.
- Lưu trữ: nói được nén theo series (Gorilla), chunk và block bất biến, inverted index theo label, downsample giữ sum và count, tier hot/cold.
- Thu thập: bảng push vs pull với tiêu chí (phát hiện target chết, job ngắn, firewall, kiểm soát tải) rồi chọn, không chọn theo thói quen.
- Alert: ít nhất 4 khái niệm for-duration, grouping, silence, routing; điểm cộng lớn cho absent alert và state persist.
- Bẫy: coi metric như log và nhét vào Elasticsearch; dùng Postgres cho 1 triệu insert/s; downsample chỉ giữ avg; quên alert cho chính pipeline.
- Dấu hiệu senior: dead man switch; giới hạn cardinality ở collector; cache query theo bucket thời gian làm tròn; biết Thanos/Cortex/Mimir giải quyết cold storage.
- Dấu hiệu junior: không phân biệt series và điểm; trả lời "dùng Kafka" cho mọi câu hỏi mà không nói đổi lấy gì.
- Người học nên liên hệ sự cố cron im lặng nhiều ngày: đó là lý do absent alert tồn tại.
`
});
window.MOCKS.push({
  id: 'M13', caseId: 'C13', title: 'Design an ad click event aggregation system', level: 3,
  prompt: "Design a real-time analytics system that aggregates ad click events: for each ad, count clicks per minute, return the top 100 most clicked ads in the last M minutes, and support filtering by attributes such as country. The numbers are used for billing, so they must be correct.\nDịch: Thiết kế hệ thống phân tích real-time gộp click quảng cáo: đếm click theo ad mỗi phút, top 100 ad trong M phút, lọc theo thuộc tính như quốc gia. Số dùng để tính tiền nên phải đúng.",
  clarify: [
    "Hỏi: How many clicks per day and how many ads? → Đáp: one billion clicks per day, about two million active ads.",
    "Hỏi: How fresh must the numbers be? → Đáp: a few minutes end to end is fine.",
    "Hỏi: Can events arrive late or duplicated? → Đáp: yes, both, because of client retries and mobile networks.",
    "Hỏi: Must real-time numbers be exact, or eventually correct? → Đáp: real-time may be slightly off; billing numbers at end of day must be exact.",
    "Hỏi: How far back do queries go? → Đáp: 30 days for aggregates, raw kept one year.",
    "Hỏi: Which attributes to filter on? → Đáp: country and device; ip only for dedup.",
    "Hỏi: Is click fraud detection in scope? → Đáp: no, just leave a hook."
  ],
  phases: {
    req: { checks: ['Hỏi về trùng lặp và đến muộn', 'Phân biệt số real-time và số billing', 'Chốt lọc theo thuộc tính nào, loại ip', 'Nêu độ trễ chấp nhận vài phút'], hint: `
- Câu hỏi quan trọng nhất: đúng ngay hay đúng cuối cùng.
- Hỏi raw giữ bao lâu để biết có recompute được không.
- Ghi ngoài phạm vi: fraud, phân phối quảng cáo.
` },
    est: { checks: ['Ra ~10k event/s trung bình, ~50k đỉnh', 'Ra ~100 GB raw/ngày', 'Ước lượng dòng aggregate và state Flink', 'Kết luận: khó ở đúng, không ở dung lượng'], hint: `
- 10^9 / 10^5 = 10k/s.
- Event ~100 B → 100 GB/ngày.
- State dedup: 50k/s × 600 s × 16 B ≈ 480 MB.
` },
    hld: { checks: ['Sơ đồ: log service → Kafka (key ad_id) → Flink window 1 phút → Kafka → writer upsert → OLAP; raw → S3; batch recompute', 'Luồng đọc top-N từ OLAP', 'Mô hình: clicks_raw, clicks_minute key (ad_id, minute, country, device)', 'event_id sinh ở client'], hint: `
- Partition theo ad_id để gộp cục bộ.
- Output cửa sổ là giá trị tuyệt đối, upsert theo key.
- Raw trên S3 là nguồn sự thật.
` },
    deep: { checks: ['Exactly-once state vs sink; dedup + idempotent upsert', 'Watermark, allowed lateness, side output với số cụ thể', 'Lambda vs kappa vs kappa + raw, chọn và lý do', 'Top-N và lọc thuộc tính bằng pre-aggregate, OLAP cột'], hint: `
- Flink exactly-once không làm sink exactly-once.
- Watermark 15 s, lateness 2 phút, quá thì side output.
- Stream phục vụ nhìn, batch phục vụ tiền.
- Hot key: salt rồi gộp lần hai.
` },
    wrap: { checks: ['Giải thích vì sao số đổi sau nửa đêm là thiết kế', 'Nêu cờ final trên report', 'Nêu metric: lag consumer, late events, mismatch stream vs batch'], hint: `
- Tài liệu hoá SLA số final sau 02:00.
- Đo phân phối độ trễ event để chọn lateness.
- Nhắc Spark Structured Streaming là lựa chọn tương đương.
` }
  },
  followups: [
    "Why partition Kafka by ad id and what do you do about a hot ad?",
    "Flink has exactly-once checkpoints. Why do you still worry about duplicates?",
    "How do you choose the watermark and allowed lateness?",
    "What happens if the stream job is down for an hour?",
    "Why keep raw events on S3 when you already have per-minute aggregates?",
    "The billing team says numbers changed overnight. Is that a bug?",
    "How do you dedupe without unbounded state?",
    "How would you support filtering by a high-cardinality attribute?"
  ],
  rubric_notes: `
- Câu trả lời mạnh tách ba câu hỏi: trùng lặp (dedup theo event_id + idempotent upsert), đến muộn (watermark, lateness, side output), và sửa số (raw bất biến + batch recompute).
- Phải nói rõ exactly-once của Flink chỉ cho state nội bộ; output đúng một lần nhờ sink idempotent hoặc two-phase commit.
- Kiến trúc dữ liệu: raw trên S3 là nguồn sự thật; stream cho dashboard, batch cho billing; cùng logic chạy hai chế độ.
- Truy vấn: pre-aggregate theo phút và thuộc tính ít giá trị; OLAP cột; cache top-N; từ chối lọc theo ip.
- Bẫy: dùng OLAP đếm thẳng raw; watermark 0 hoặc vô hạn; coi số real-time là số billing; không có event_id từ client.
- Dấu hiệu senior: nói về hot key salt; state TTL; đo phân phối độ trễ để chọn lateness; cờ final và SLA cho billing.
- Dấu hiệu junior: liệt kê công nghệ (Kafka, Flink, Druid) không giải thích event time vs processing time.
- Liên hệ tốt: pipeline enrichment hoặc metric snapshot của hệ SBOM cũng cần raw và recompute thay vì one-shot.
`
});
window.MOCKS.push({
  id: 'M14', caseId: 'C14', title: 'Design a proximity service (nearby search)', level: 2,
  prompt: "Design a proximity service like Yelp nearby search: given the user location and a radius, return nearby businesses. Business owners can add, update, or delete their listings. Assume 100 million daily active users and 200 million businesses.\nDịch: Thiết kế dịch vụ tìm địa điểm lân cận kiểu Yelp: từ vị trí và bán kính trả doanh nghiệp gần đó; chủ doanh nghiệp CRUD listing. 100 triệu DAU, 200 triệu doanh nghiệp.",
  clarify: [
    "Hỏi: What radius range? → Đáp: 0.5 to 20 km, chosen by the user.",
    "Hỏi: Sort by distance or by rating? → Đáp: distance first; rating later.",
    "Hỏi: How quickly must a new listing appear in search? → Đáp: within the day is fine.",
    "Hỏi: How many results per page? → Đáp: up to 20, paginated.",
    "Hỏi: Global or single region? → Đáp: global, multiple regions.",
    "Hỏi: Do we need real-time moving users, like nearby friends? → Đáp: as an extension if time permits."
  ],
  phases: {
    req: { checks: ['Chốt đọc nhiều ghi ít và eventual consistency cho listing', 'Hỏi bán kính và số kết quả', 'Nêu p99 dưới 200 ms', 'Để nearby friends làm mở rộng'], hint: `
- Hỏi độ tươi của listing: câu trả lời "trong ngày" mở đường cho replica và cache.
- Chốt functional: nearby search, chi tiết, CRUD.
- Ngoài phạm vi: review, ảnh, xếp hạng.
` },
    est: { checks: ['Ra ~5k QPS tìm kiếm, ~15k đỉnh', 'Ra ~25 ghi/s', 'Ra geo index ~3 GB vừa RAM', 'Kết luận: bài về index không gian và cache'], hint: `
- 100M × 5 / 10^5 = 5k QPS.
- 200M × (geohash + id ~16 B) ≈ 3,2 GB.
- Business 200M × 1 KB = 200 GB.
` },
    hld: { checks: ['Sơ đồ tách LBS (đọc) và Business service (ghi), replica, cache theo ô', 'Luồng đọc: tính ô + 8 ô lân cận → cache → index → chi tiết → lọc khoảng cách', 'Bảng geo_index (geohash, business_id)', 'Bảng độ dài geohash và kích thước ô'], hint: `
- Geohash 6 ≈ 1,2 km × 0,6 km cho bán kính 1 km.
- Index cập nhật cùng transaction hoặc job hằng đêm.
- Cache key theo ô geohash, TTL 1 giờ.
` },
    deep: { checks: ['Bảng geohash vs quadtree vs S2 với tiêu chí', 'Vấn đề biên và 9 ô, mở rộng bằng bỏ 1 ký tự', 'Cache theo ô, replica, multi-region', 'Nearby friends: WebSocket, pub/sub theo user, TTL, fan-out số liệu'], hint: `
- Quadtree thích nghi mật độ nhưng phải ở RAM và rebuild.
- S2 phủ vùng chính xác, ít người quen.
- Nearby friends: 330k publish/s × 400 = 130M msg/s, shard pub/sub.
` },
    wrap: { checks: ['Nói khi nào chọn PostGIS hoặc Elasticsearch thay geohash tay', 'Xử lý vùng quá đông kết quả', 'Nêu điều sẽ đo sau khi ra production'], hint: `
- Production chọn công cụ đội ngũ vận hành tốt.
- Shinjuku: tăng độ dài geohash, phân trang, lọc category.
- Đo hit rate cache theo ô và p99.
` }
  },
  followups: [
    "Why not just use PostGIS or Elasticsearch geo queries?",
    "How do you handle a dense area that returns thousands of results?",
    "A business moved two kilometers. When does search reflect it?",
    "Why query nine cells instead of computing the exact circle?",
    "How would you add ranking by rating without slowing search?",
    "Can one Redis instance hold the whole geo index?",
    "Design nearby friends for ten million online users. Where is the bottleneck?",
    "When does a quadtree beat a geohash?"
  ],
  rubric_notes: `
- Câu trả lời mạnh nói ngay đây là bài đọc nhiều với index không gian, rồi giải thích geohash bằng ví dụ kích thước ô và vấn đề biên.
- Bảng so sánh geohash, quadtree, S2 với tiêu chí lưu ở đâu, mật độ, cập nhật, vận hành; chọn có lý do.
- Kiến trúc: tách LBS khỏi Business service, replica, cache theo ô geohash chứ không theo toạ độ.
- Mở rộng nearby friends: WebSocket, kênh pub/sub theo user, TTL vị trí, ước lượng fan-out và nói ra shard.
- Bẫy: query BETWEEN trên lat và lng; cache theo toạ độ chính xác; quên 8 ô lân cận; vẽ sharding DB cho 25 ghi/s.
- Dấu hiệu senior: biết Redis GEO dùng geohash 52 bit bên trong; mở rộng ô khi thiếu kết quả; multi-region theo vị trí người dùng.
- Dấu hiệu junior: không ước lượng, chọn công cụ theo tên, không giải thích biên.
- Liên hệ hệ SBOM: chuẩn hoá key cache và tách đường đọc khỏi đường ghi.
`
});
window.MOCKS.push({
  id: 'M15', caseId: 'C15', title: 'Design a distributed message queue', level: 3,
  prompt: "Design a distributed message queue similar to Kafka. Producers publish messages to topics, consumers subscribe and read them, messages are persisted and delivered at least once with ordering inside a partition. It should scale to millions of messages per second.\nDịch: Thiết kế message queue phân tán kiểu Kafka: producer publish vào topic, consumer subscribe, message lưu bền, giao ít nhất một lần, giữ thứ tự trong partition, scale tới hàng triệu message mỗi giây.",
  clarify: [
    "Hỏi: Queue semantics, pub/sub, or both? → Đáp: both, via consumer groups.",
    "Hỏi: Do consumers need to replay old messages? → Đáp: yes, retain seven days.",
    "Hỏi: Message size? → Đáp: average 1 KB, max 1 MB.",
    "Hỏi: Ordering across the whole topic or per partition? → Đáp: per partition is enough.",
    "Hỏi: Delivery guarantee? → Đáp: at-least-once by default; discuss exactly-once if time permits.",
    "Hỏi: Latency target? → Đáp: under 100 ms at p99 end to end.",
    "Hỏi: How many brokers can fail at once? → Đáp: one out of three replicas."
  ],
  phases: {
    req: { checks: ['Chốt consumer group cho cả queue và pub/sub', 'Hỏi replay và retention', 'Chốt thứ tự theo partition', 'Nêu độ bền khi mất 1 broker'], hint: `
- Replay là yêu cầu quyết định log bền thay vì xoá sau ack.
- Hỏi kích thước message để tính băng thông.
- Ghi ngoài phạm vi: schema registry, stream processing.
` },
    est: { checks: ['Ra ~1 GB/s ingress, ~3 GB/s ghi đĩa với RF 3', 'Ra ~1,8 PB cho 7 ngày', 'Ra số broker theo đĩa (~180) và theo mạng (~6)', 'Kết luận: đĩa quyết định, cần sequential IO'], hint: `
- 10^6 × 1 KB = 1 GB/s.
- × 86 400 × 7 × 3 = 1,8 PB.
- 10 TB mỗi broker → 180 broker.
` },
    hld: { checks: ['Sơ đồ: producer, metadata, leader, follower ISR, coordinator, offsets topic', 'Luồng ghi với acks và high watermark', 'Luồng đọc pull theo offset, commit', 'Cấu trúc đĩa: segment log, index sparse, time index'], hint: `
- Producer hỏi metadata tìm leader, gom batch.
- Follower fetch từ leader; đủ ISR thì tăng high watermark.
- Consumer chỉ đọc tới high watermark.
` },
    deep: { checks: ['Vì sao append-only + page cache + zero-copy nhanh', 'ISR, acks, min.insync.replicas, unclean election, bảng cấu hình', 'Consumer group, offset, rebalance eager vs cooperative, max.poll.interval và xử lý đúp', 'Push vs pull; exactly-once = idempotent producer + transaction + sink idempotent'], hint: `
- Bảng 3 phương án lưu: RAM queue, B-tree DB, segment log.
- acks=all + min.isr=2 chịu 1 broker chết.
- Static membership tránh rebalance khi rolling deploy.
` },
    wrap: { checks: ['Chọn số partition thế nào', 'KRaft thay ZooKeeper vì sao', 'Nêu client phải xử lý reconnect và NotLeader'], hint: `
- Partition dư 2 lần so với nhu cầu; đổi sau làm hỏng thứ tự theo key.
- Message 1 MB: để payload ở object storage.
- Liên hệ sự cố publisher không reconnect.
` }
  },
  followups: [
    "Why does ordering only hold inside a partition?",
    "How do you pick the number of partitions and what if you need more later?",
    "What does acks=all with min.insync.replicas=2 protect against?",
    "What happens to a consumer that takes longer than max.poll.interval?",
    "Why pull instead of push?",
    "What does exactly-once actually mean in Kafka?",
    "Why did Kafka move from ZooKeeper to KRaft?",
    "How should a client behave when a broker restarts?"
  ],
  rubric_notes: `
- Câu trả lời mạnh bắt đầu từ cấu trúc đĩa: partition là log append-only chia segment, index thưa, page cache, zero-copy; mọi thứ khác xây trên đó.
- Độ bền: ISR, acks, min.insync.replicas, high watermark, unclean election; có bảng cấu hình với mất dữ liệu khi nào.
- Consumer: group, offset commit sau xử lý, rebalance và hệ quả xử lý đúp khi poll chậm.
- Ước lượng ra số broker theo đĩa và theo mạng, kết luận đĩa quyết định.
- Bẫy: lưu message trong DB; nói "replicate 3 bản" không nói ISR; coi exactly-once là thuộc tính của broker; quên offset topic.
- Dấu hiệu senior: static membership cho rolling deploy; follower fetching theo rack; log compaction cho topic trạng thái; client reconnect và refresh metadata.
- Dấu hiệu junior: không phân biệt partition và topic; không biết vì sao pull.
- Liên hệ hệ SBOM: publisher RabbitMQ singleton không reconnect là bài học về client; outbox cho publish trước commit.
`
});
window.MOCKS.push({
  id: 'M16', caseId: 'C16', title: 'Design a hotel reservation system', level: 2,
  prompt: "Design a hotel reservation system like the one behind Marriott.com: users search hotels, view room types and prices, reserve and pay; hotel staff manage inventory. We have 5 000 hotels and 1 million rooms, and the business wants to allow 10 percent overbooking.\nDịch: Thiết kế hệ đặt phòng khách sạn kiểu Marriott: tìm, xem loại phòng và giá, đặt và thanh toán; nhân viên quản lý tồn. 5 000 khách sạn, 1 triệu phòng, cho phép overbooking 10%.",
  clarify: [
    "Hỏi: Do users book a room type or a specific room? → Đáp: a room type; the room number is assigned at check-in.",
    "Hỏi: What exactly does 10 percent overbooking mean? → Đáp: reserved rooms per day may exceed real inventory by up to 10 percent.",
    "Hỏi: Pay at booking or at check-in? → Đáp: at booking, through an external PSP.",
    "Hỏi: Do prices vary by date? → Đáp: yes, per hotel, room type and date.",
    "Hỏi: How long do we hold a reservation during payment? → Đáp: 10 minutes.",
    "Hỏi: Can a hotel reduce inventory below current reservations? → Đáp: yes, staff get a warning."
  ],
  phases: {
    req: { checks: ['Chốt đặt theo loại phòng', 'Định nghĩa overbooking bằng công thức', 'Hold 10 phút và thanh toán qua PSP', 'Strong consistency cho bước đặt, eventual cho tìm kiếm'], hint: `
- Câu hỏi "loại phòng hay phòng cụ thể" quyết định mô hình dữ liệu.
- Ghi non-functional: không double booking, không vượt tồn × 1,1.
- Ngoài phạm vi: loyalty, kênh đại lý.
` },
    est: { checks: ['Ra ~240k reservation/ngày, ~3 TPS, ~30 đỉnh', 'Ra ~300 QPS tìm kiếm, đỉnh 3 000', 'Ra bảng inventory ~18 triệu dòng ≈ 2 GB', 'Kết luận: một Postgres đủ, bài về concurrency'], hint: `
- 1M phòng × 70% / 3 đêm = 240k/ngày.
- 5 000 × 5 loại × 730 ngày = 18M dòng.
- Nói to: không shard sớm.
` },
    hld: { checks: ['Sơ đồ: Hotel, Rate, Reservation, Payment service; Reservation DB chứa inventory + reservation', 'Luồng đặt: draft id → đặt PENDING trừ tồn → thanh toán → CONFIRMED', 'Bảng room_type_inventory (hotel_id, room_type_id, date) với total_reserved', 'Tìm kiếm đọc cache và replica, xấp xỉ'], hint: `
- reservation_id lấy trước làm idempotency key.
- reservation_day để hoàn tồn từng ngày.
- Payment là saga với bước bù.
` },
    deep: { checks: ['Ba cách chống double booking với SQL và khi nào dùng', 'Khoá theo thứ tự ngày tránh deadlock, isolation level', 'Hold/expire worker, confirm đến muộn, idempotent', 'Overbooking là tham số theo hotel; ranh giới service và shard theo hotel_id khi cần'], hint: `
- UPDATE ... WHERE total_reserved + 1 <= total_inventory * ratio, kiểm tra rows affected.
- READ COMMITTED đủ với UPDATE có điều kiện.
- Không tách inventory thành service riêng.
` },
    wrap: { checks: ['Trả lời vì sao không dùng Redis DECR làm sự thật', 'Nêu khi nào sẽ shard và theo gì', 'Nêu alert cho overbooking vượt thực tế'], hint: `
- Redis là cache hoặc timer, DB là trọng tài.
- Shard theo hotel_id khi 50 TB hoặc 10k TPS ghi.
- Tỉ lệ overbooking theo lịch sử huỷ của từng hotel.
` }
  },
  followups: [
    "Why model inventory per day rather than per physical room?",
    "Why not use Redis DECR for inventory?",
    "Which isolation level do you need and why?",
    "How do you avoid deadlocks when booking several nights?",
    "Payment succeeded but the confirm call failed. What now?",
    "Where exactly would you put the 10 percent overbooking rule?",
    "How would you shard if you had to?",
    "Search shows a room that is gone by the time I book. Is that acceptable?"
  ],
  rubric_notes: `
- Câu trả lời mạnh nhận ra ngay tải ghi rất nhỏ và chuyển trọng tâm sang concurrency và mô hình inventory theo ngày.
- Phải trình bày được ba cách chống double booking (pessimistic, optimistic, điều kiện trong UPDATE) với SQL và tiêu chí chọn; điểm cộng cho CHECK constraint làm lưới an toàn.
- Idempotent booking qua reservation_id lấy trước; hold/expire bằng worker; saga với thanh toán và bước bù.
- Overbooking là tham số nghiệp vụ cấu hình theo hotel, không hard-code.
- Bẫy: bảng room với cột is_booked; tách inventory thành service riêng rồi phát minh lại transaction; dùng Redis làm nguồn sự thật; shard 2 GB dữ liệu.
- Dấu hiệu senior: khoá theo thứ tự ngày; nói về rows affected = 0; phân biệt tìm kiếm xấp xỉ và đặt chính xác; nêu ngưỡng khi mới shard.
- Dấu hiệu junior: nói "dùng transaction" mà không nói isolation hay khoá gì.
- Liên hệ hệ SBOM: UPDATE có điều kiện cho status machine; lease cho sweeper; partition theo tenant như shard theo hotel.
`
});
window.MOCKS.push({
  id: 'M17', caseId: 'C17', title: 'Design a web crawler', level: 3,
  prompt: "Design a web crawler for a search engine. It should fetch about one billion pages per month, respect robots.txt, avoid overloading any single website, handle duplicate content and crawler traps, and keep the index reasonably fresh.\nDịch: Thiết kế web crawler cho search engine: 1 tỷ trang/tháng, tôn trọng robots.txt, không quá tải website nào, xử lý trùng nội dung và bẫy crawler, giữ index tương đối mới.",
  clarify: [
    "Hỏi: What content types? → Đáp: HTML only; skip images, video, PDF.",
    "Hỏi: Do we render JavaScript? → Đáp: not in the first version.",
    "Hỏi: How long do we keep fetched HTML? → Đáp: five years, for re-indexing.",
    "Hỏi: What politeness rule? → Đáp: at most one request per second per host unless robots.txt says otherwise.",
    "Hỏi: How fresh? → Đáp: news within hours, static pages within weeks; the crawler should learn change rates.",
    "Hỏi: How do we prioritize? → Đáp: by approximate page importance and update frequency, seeded from major domains.",
    "Hỏi: Average page size? → Đáp: about 500 KB including inline resources."
  ],
  phases: {
    req: { checks: ['Chốt HTML only, không render JS', 'Nêu politeness 1 req/s/host và robots.txt', 'Nêu freshness thích nghi', 'Chịu lỗi: worker chết không mất frontier'], hint: `
- Hỏi mục đích crawl để biết lưu gì.
- Hỏi politeness: nó quyết định cấu trúc frontier.
- Ngoài phạm vi: indexing, ranking.
` },
    est: { checks: ['Ra ~400 trang/s, ~800 đỉnh', 'Ra ~200 MB/s băng thông, ~100 TB/tháng nén', 'Ra Bloom filter ~12 GB cho 10^10 URL', 'Kết luận: khó ở frontier và dedup, không ở compute'], hint: `
- 10^9 / 2,6 × 10^6 s ≈ 400/s.
- 400 × 500 KB = 200 MB/s.
- 9,6 bit mỗi URL cho 1% FP.
` },
    hld: { checks: ['Sơ đồ: seed → frontier → fetcher (DNS, robots) → storage → parser → content seen → extractor → filter → URL seen → frontier; scheduler recrawl', 'Luồng một trang từ frontier tới link mới', 'Bảng page_meta, host_state, frontier shard, html object', 'Chuẩn hoá URL trước khi dedup'], hint: `
- Lưu HTML thô vào S3 với key hash URL, metadata vào DB.
- robots.txt cache theo host 24 giờ.
- Lease cho URL đang fetch.
` },
    deep: { checks: ['Frontier Mercator: front queue ưu tiên, back queue theo host, heap thời gian', 'Bloom filter URL và SimHash nội dung với số liệu', 'Trap: độ sâu, độ dài URL, quota host, pattern; host lỗi backoff không dừng worker', 'Shard frontier theo host; DNS cache; recrawl adaptive theo change_rate'], hint: `
- Priority queue đơn thuần vi phạm politeness.
- SimHash Hamming ≤ 3, index theo 4 khối 16 bit.
- Shard theo host làm politeness cục bộ.
` },
    wrap: { checks: ['Conditional GET với ETag để tiết kiệm', 'Headless browser pool cho JS khi cần', 'Nêu metric: trang/s theo shard, tỉ lệ lỗi theo host, độ dài frontier'], hint: `
- Lưu nhiều phiên bản HTML để đo thay đổi.
- Blacklist thủ công vẫn cần.
- Liên hệ: gọi API ngoài theo batch cũng cần politeness per host.
` }
  },
  followups: [
    "Why not a single distributed priority queue for the frontier?",
    "What does a one percent false positive rate in the Bloom filter cost you?",
    "How do you detect near-duplicate pages?",
    "How do you know a page changed without downloading it?",
    "What happens when the node owning a frontier shard dies?",
    "How do you avoid getting blocked by websites?",
    "How would you crawl JavaScript-heavy sites?",
    "How do you decide when to recrawl a page?"
  ],
  rubric_notes: `
- Câu trả lời mạnh nói ngay 400 trang/giây là rẻ và dành thời gian cho frontier, dedup, politeness, trap.
- Frontier phải có hai trục: ưu tiên (front queue) và lịch sự (back queue theo host với heap thời gian); nêu được vì sao priority queue đơn vi phạm politeness.
- Dedup có số: Bloom filter 12 GB cho 10 tỷ URL ở 1% FP; SimHash Hamming 3 cho near-duplicate.
- Chịu lỗi theo host: backoff per host, lease cho URL đang fetch, frontier persist; worker không bao giờ dừng vì một host.
- Freshness thích nghi theo change_rate với conditional GET.
- Bẫy: một queue FIFO; hash chính xác cho trùng nội dung; quên robots.txt và DNS cache; dừng crawler khi host lỗi.
- Dấu hiệu senior: shard theo host để politeness cục bộ; trap detection nhiều lớp; lưu nhiều phiên bản HTML; biết Mercator.
- Liên hệ hệ SBOM: FetchBatch nuốt lỗi và một coordinate hỏng cả batch là bài học isolate per item và per host.
`
});
window.MOCKS.push({
  id: 'M18', caseId: 'C18', title: 'Design a distributed job scheduler', level: 2,
  prompt: "Design a distributed job scheduler, cron as a service: users define jobs with a cron expression or a one-off time, the system runs them on time at least once, survives node crashes and deployments, supports retries, and shows run history.\nDịch: Thiết kế job scheduler phân tán: job theo cron hoặc một lần, chạy đúng giờ ít nhất một lần, sống qua node chết và deploy, có retry và lịch sử chạy.",
  clarify: [
    "Hỏi: What is a job: an HTTP call, a container, an internal function? → Đáp: HTTP endpoints and internal workers; the design should not depend on it.",
    "Hỏi: How precise must firing be? → Đáp: within one minute of the scheduled time.",
    "Hỏi: What if the system is down when a job was due? → Đáp: configurable: run once, skip, or run all missed.",
    "Hỏi: Can a job overlap with its previous run? → Đáp: by default no; skip or queue.",
    "Hỏi: Scale? → Đáp: one million job definitions, about one run per hour each.",
    "Hỏi: How long do jobs run? → Đáp: seconds to 30 minutes.",
    "Hỏi: Dependencies between jobs? → Đáp: out of scope."
  ],
  phases: {
    req: { checks: ['Chốt at-least-once và không double-run', 'Hỏi misfire policy và concurrency policy', 'Nêu deploy không được mất tick', 'Ngoài phạm vi: DAG'], hint: `
- Hỏi độ chính xác: 1 phút cho phép poll DB.
- Hỏi misfire: nó là tính năng, không phải lỗi.
- Ghi non-functional: không SPOF.
` },
    est: { checks: ['Ra ~280 run/s, đỉnh ~3 300/s ở phút chẵn', 'Ra history ~12 GB/ngày', 'Kết luận: tải nhỏ, khó ở đúng và burst'], hint: `
- 10^6 / 3 600 = 280/s.
- 20% job ở :00 → 200k trong 60 s.
- Bảng job 1 GB vừa RAM.
` },
    hld: { checks: ['Sơ đồ: API, job store, scheduler partition, queue, worker, DLQ, coordinator lease, history', 'Luồng: poll due SKIP LOCKED → tạo run → publish → next_run_at từ scheduled_at', 'Bảng jobs, runs UNIQUE (job_id, scheduled_at, attempt), scheduler_leases, dead_letters', 'Partial index (partition, next_run_at) WHERE active'], hint: `
- next_run_at persist và tính từ scheduled_at trước.
- Worker claim bằng lease và heartbeat.
- Hệ nhỏ: worker poll thẳng bảng runs, không cần Kafka.
` },
    deep: { checks: ['Bảng time wheel vs sorted set vs DB index, chọn DB làm sự thật', 'Không lỡ tick: persist; không đúp: partition lease hoặc SKIP LOCKED + UNIQUE', 'Lease, heartbeat, requeue, idempotent theo run_id, retry/backoff, DLQ, concurrency policy', 'Misfire policy, jitter cho burst, metric lag và absent'], hint: `
- gocron in-memory + redeploy = lỡ tick.
- SQL: UPDATE jobs ... WHERE job_id IN (SELECT ... FOR UPDATE SKIP LOCKED).
- Fire-once mặc định, ngưỡng 5 phút.
` },
    wrap: { checks: ['Trả lời vì sao không dùng Kubernetes CronJob', 'Rolling deploy với lease', 'Timezone và DST'], hint: `
- Dùng now() của DB làm chuẩn thời gian.
- Exactly-once không khả thi với side effect ngoài.
- LISTEN/NOTIFY để đánh thức sớm.
` }
  },
  followups: [
    "Why not just use Kubernetes CronJob or a cloud scheduler?",
    "Why poll the database every second instead of being event-driven?",
    "How do you deploy the scheduler without missing a run?",
    "How do you guarantee a job is not run twice by two nodes?",
    "A worker dies right after finishing a job. What happens?",
    "What happens when clocks drift between nodes?",
    "How do you handle 200 thousand jobs all scheduled at the top of the hour?",
    "How do you handle daylight saving time?"
  ],
  rubric_notes: `
- Câu trả lời mạnh đặt nguồn sự thật của lịch vào DB (next_run_at persist, tính từ scheduled_at), và giải thích vì sao in-memory timer lỡ tick khi deploy.
- Chống đúp bằng partition lease hoặc SKIP LOCKED + UNIQUE (job_id, scheduled_at); giải thích DB là trọng tài.
- Thực thi at-least-once với lease, heartbeat, requeue; nói ra job phải idempotent theo run_id.
- Misfire policy, concurrency policy, retry/backoff, DLQ là tính năng có tên; burst phút chẵn xử lý bằng jitter và queue.
- Bẫy: Kafka + ZooKeeper cho 280 run/giây; quên misfire; tính next_run từ now() làm lệch lịch; không có lease nên worker chết là mất run.
- Dấu hiệu senior: nói "một bảng Postgres với SKIP LOCKED là đủ cho hệ nhỏ"; metric scheduler lag và alert absent; dùng now() của DB; LISTEN/NOTIFY.
- Dấu hiệu junior: thiết kế quanh một leader duy nhất giữ timer trong RAM.
- Liên hệ hệ SBOM: sự cố gocron + Watchtower chính là đề bài; Last Scanned phải lấy từ run succeeded, không từ side effect cuối hàm.
`
});
window.MOCKS.push({
  id: 'M19', caseId: 'C19', title: 'Design an SBOM analysis platform', level: 3,
  prompt: "Design a multi-tenant SBOM analysis platform. Customers upload SBOM files in CycloneDX or SPDX format, some with up to 200 thousand components. The platform resolves components, enriches them with license and vulnerability data from external sources, evaluates customer policies, and notifies users. Assume 100 tenants, 1 000 targets, and 50 thousand components per target.\nDịch: Thiết kế nền tảng phân tích SBOM đa tenant: upload CycloneDX/SPDX tới 200k component, chuẩn hoá component, enrich license và vulnerability từ nguồn ngoài, đánh giá policy, thông báo. 100 tenant, 1 000 target, 50k component mỗi target.",
  clarify: [
    "Hỏi: What data may be shared across tenants? → Đáp: public facts such as vulnerabilities and registry licenses; anything a tenant declares or overrides is private.",
    "Hỏi: Which external sources and what limits? → Đáp: ClearlyDefined in batches of 100, OSV, NVD, GHSA; each has rate limits and is sometimes slow or failing.",
    "Hỏi: SLA after upload? → Đáp: components visible within a minute, most enrichment within 15 minutes, complete within an hour.",
    "Hỏi: What is a policy and how are results used? → Đáp: rules on license, severity, EOL; results feed an audit view and must not be lost or flicker.",
    "Hỏi: Scheduled scans? → Đáp: daily feed sync, re-match all components, re-evaluate policies, notify changes.",
    "Hỏi: Largest tenant? → Đáp: one tenant may upload 200 thousand component stress files; it must not slow others.",
    "Hỏi: Team size and ops budget? → Đáp: small team; low operational cost matters."
  ],
  phases: {
    req: { checks: ['Phân biệt dữ liệu công khai dùng chung và dữ liệu tenant riêng', 'Chốt SLA theo ba mốc 1 phút, 15 phút, 1 giờ', 'Nêu violation không mất và không nháy', 'Tenant isolation về tài nguyên, không chỉ dữ liệu'], hint: `
- Câu hỏi về chia sẻ dữ liệu quyết định mô hình overlay.
- Hỏi giới hạn của nguồn ngoài để thiết kế batch và rate limit.
- Ngoài phạm vi: sinh SBOM, VEX đầy đủ, billing.
` },
    est: { checks: ['Ra 50 triệu dòng liên kết, ~5 triệu component duy nhất', 'Ra ~600 dòng/s ghi trung bình, ~850 dòng/s cho một upload', 'Ra 50k request ClearlyDefined ≈ 1,4 giờ ở 10 req/s', 'Ra RAM nếu preload: 500 MB mỗi project, 2 GB cho 200k'], hint: `
- 1 000 × 50k = 50M; chia 10 cho trùng lặp.
- 5M / 100 mỗi batch = 50k request.
- Policy one-shot: 100 × 10 × 50k × 10 = 5 tỷ phép so sánh.
` },
    hld: { checks: ['Sơ đồ: FE, API, S3, Postgres, RabbitMQ, parser stream, enrichment coordinator, Redis, Lambda, nguồn ngoài, sweeper, policy evaluator, scheduler, outbox, observability', 'Luồng upload với idempotency key và stream parse', 'Bảng components shared, component_enrichment, tenant_component_overlay, target_revision_components partition tenant, policy_eval_runs + active_run, outbox, scheduled_jobs', 'API dùng keyset pagination và read replica'], hint: `
- Presigned URL cho file lớn, không qua API.
- Resolver license duy nhất: override → declared → enriched → unknown.
- Violation đọc qua con trỏ active_run.
` },
    deep: { checks: ['Shared + overlay với bảng so sánh và quy tắc cứng về nguồn', 'Enrichment: batch theo nguồn, rate limit theo host, isolate per item với bisect, status machine backoff, sweeper round-robin tenant với partial index, cache L1, fail fast env', 'Policy: run_id + con trỏ active, incremental theo diff, partition violation theo tenant', 'Scheduler persist, outbox với reconnect, alert absent, memory bound worker, runbook FDW'], hint: `
- Mỗi điểm nên gắn một sự cố thật làm bằng chứng.
- Zombie lùi ra sau nhờ next_attempt_at.
- Run lỗi không bao giờ đụng con trỏ active.
` },
    wrap: { checks: ['Trả lời vì sao chia sẻ dữ liệu và ranh giới ở đâu', 'MVP cắt gì, giữ gì', 'Metric thành công: pending_age p95, violation mồ côi, RAM worker, tick không lỡ'], hint: `
- Cắt Lambda và Elasticsearch trước; giữ outbox, status machine, scheduler persist.
- Target Details là sự thật, dashboard là snapshot có cờ.
- Kể câu chuyện "tôi thiết kế lại sau các sự cố" bằng số.
` }
  },
  followups: [
    "Why share any data across tenants at all, and where exactly is the boundary?",
    "Why run enrichment on Lambda instead of inside the worker?",
    "How do you keep one noisy tenant from starving the others?",
    "Why not evaluate policies synchronously during upload?",
    "A policy evaluation returns zero results because of a transient error. What happens to the audit view?",
    "How do you know enrichment is stuck within fifteen minutes rather than days?",
    "How would you handle a 200 thousand component upload end to end?",
    "What would you cut for an MVP and what would you never cut?",
    "How do you keep worker memory bounded on a 200 thousand component target?"
  ],
  rubric_notes: `
- Đây là capstone: người học phải trình bày hệ thống mình đang làm như một thiết kế có chủ đích, mỗi quyết định gắn với một sự cố thật và một con số.
- Multi-tenant: phân biệt dữ liệu công khai dùng chung và overlay per-tenant; một resolver duy nhất; test cùng purl hai tenant ra khác nhau.
- Enrichment: batch theo nguồn, rate limit theo host, isolate per item (validate trước, bisect khi lỗi, không nuốt lỗi), status machine với backoff, sweeper round-robin tenant với partial index, cache L1, fail fast khi thiếu env.
- Policy: run_id và con trỏ active thay cho xoá rồi ghi; incremental theo diff; partition violation theo tenant.
- Vận hành: scheduler persist với SKIP LOCKED và lease; outbox với reconnect; alert absent 15 phút; worker memory bound; runbook FDW refresh.
- Bẫy: một cột tenant_id là xong; gọi API ngoài trong vòng lặp; FIFO cho sweeper; one-shot eval; timer trong RAM; publish trước commit; Preload toàn bộ.
- Dấu hiệu senior: nói rõ ranh giới shared vs overlay bằng nguồn dữ liệu; nói MVP cắt Lambda và Elasticsearch nhưng không cắt correctness; đưa ra số đo thành công.
- Dấu hiệu rất mạnh: kể lại 3 sự cố theo khung bối cảnh, nguyên nhân gốc, thay đổi thiết kế, kết quả đo được, trong dưới 2 phút mỗi sự cố.
- Follow-up về tenant ồn ào phải nhắc đủ ba lớp: sweeper round-robin, quota rate limiter chia theo tenant, queue theo tenant hash.
`
});
