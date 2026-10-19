/* ===== MOCKS_EXTRA: 6 đề "lạ" X1–X6, không có bài case đi kèm nên mỗi đề có reference (lời giải rút gọn) ===== */
window.MOCKS = window.MOCKS || [];
window.MOCKS.push({
  id: 'X1',
  title: 'Design a flash-sale / high-concurrency ticketing system',
  level: 3,
  prompt: `Design the backend for a flash sale: 10,000 units of one product go on sale at exactly 10:00, and we expect about 2 million people to try to buy within the first minute. We must never oversell, each user can buy at most one, and the site must stay up for everyone else.
Thiết kế backend cho flash sale: 10 000 sản phẩm mở bán đúng 10:00, ~2 triệu người cố mua trong phút đầu. Không được bán quá kho, mỗi người tối đa 1, và site không được sập với người dùng khác.`,
  clarify: [
    `Hỏi: Bao nhiêu SKU và bao nhiêu đơn vị mỗi SKU? → Đáp: 1–5 SKU, mỗi SKU ~10 000 đơn vị; thiết kế cho 1 SKU rồi nhân lên.`,
    `Hỏi: Giới hạn mua mỗi người? → Đáp: 1 đơn vị/người/SKU; người dùng phải đăng nhập và xác thực số điện thoại trước giờ bán.`,
    `Hỏi: Oversell có chấp nhận được không? Undersell? → Đáp: Oversell tuyệt đối không. Undersell tạm thời (giữ chỗ chưa thanh toán rồi hết hạn) chấp nhận được, kho phải được trả lại.`,
    `Hỏi: Thanh toán nằm trong phạm vi không? → Đáp: Giữ chỗ 10 phút, thanh toán qua provider ngoài; hết hạn chưa trả thì hủy và hoàn kho. Chi tiết tích hợp PSP ngoài phạm vi.`,
    `Hỏi: Cần công bằng FIFO tuyệt đối không? → Đáp: Không, "gần công bằng" là đủ, nhưng phải chặn bot/script mua hộ.`,
    `Hỏi: Đỉnh tải cụ thể? → Đáp: 2 triệu người bấm trong 60 s, dồn vào 5–10 s đầu → ~100k RPS vào nút "Mua" lúc đỉnh; traffic xem trang gấp 10 lần.`,
    `Hỏi: Hệ thống e-commerce hiện tại có được đụng không? → Đáp: Catalog/giỏ hàng/đơn hàng thường có sẵn; flash sale là luồng riêng, chỉ ghi đơn cuối cùng vào hệ thống đơn hàng chung.`
  ],
  phases: {
    req: {
      checks: [
        `Nêu rõ bất biến số 1: sold ≤ stock, mọi lúc, kể cả khi lỗi/retry.`,
        `Giới hạn 1 đơn vị/người và cần định danh đã xác thực trước giờ bán.`,
        `Tách giữ chỗ (reservation có TTL) khỏi thanh toán; hoàn kho khi hết hạn.`,
        `Non-functional: đỉnh ~100k RPS vào nút mua, p99 trả lời "được/hết" < 1 s, không ảnh hưởng phần còn lại của site.`,
        `Chống bot là yêu cầu chức năng, không phải "nice to have".`,
        `Ngoài phạm vi: tích hợp PSP chi tiết, catalog, khuyến mãi phức tạp.`
      ],
      hint: `Bắt đầu bằng câu: "Bất biến quan trọng nhất là không bao giờ bán quá 10 000; mọi thứ khác (công bằng, UX) có thể nới." Hỏi về TTL giữ chỗ và thanh toán vì nó quyết định có cần hoàn kho hay không. Hỏi đỉnh tải theo giây, không theo phút — flash sale dồn vào vài giây đầu. Đừng quên hỏi "1 người = 1 tài khoản hay 1 số điện thoại hay 1 thẻ" — câu trả lời quyết định cách dedup.`
    },
    est: {
      checks: [
        `2 triệu người / 60 s ≈ 33k RPS trung bình; đỉnh 5–10 s đầu → ~100k RPS vào nút mua.`,
        `Chỉ 10 000 / 2 000 000 = 0,5% request cần đi đến tầng tạo đơn; 99,5% phải bị chặn rẻ ở tầng trước.`,
        `Redis: 1 DECR/giữ chỗ ≈ 10k lệnh ghi thành công + hàng trăm nghìn lệnh "hết hàng" → 1 node Redis (~100k ops/s) đủ nếu đã lọc bớt ở gate.`,
        `Postgres chỉ nhận ~10k INSERT reservation + ~10k order trong vài phút → không phải bottleneck nếu không đặt nó trước Redis.`,
        `Băng thông: trang chờ static qua CDN; API trả JSON ~200 B × 100k RPS ≈ 20 MB/s — nhỏ.`
      ],
      hint: `Viết ra phễu: 2M người → gate cho qua theo tốc độ Redis chịu được (ví dụ 20k/s) → Redis trả lời được/hết trong 1 lệnh → 10k reservation vào DB. Con số cần nói to: tỉ lệ 0,5% nghĩa là thiết kế để **từ chối nhanh** 99,5%. Peak tính theo giây; nếu phỏng vấn viên nói "2 triệu trong 1 phút", hãy giả định một nửa đến trong 5 giây đầu.`
    },
    hld: {
      checks: [
        `Sơ đồ có: CDN + trang static đếm ngược, queue gate/waiting room cấp token, Order API stateless, Redis inventory, Postgres reservation/order, queue + worker thanh toán, job hết hạn.`,
        `Luồng ghi: token hợp lệ → Lua DECR + SADD user atomic → tạo reservation (DB) → trả reservation_id → thanh toán → confirm.`,
        `API: POST /queue/enter, GET /queue/status, POST /sale/{sku}/reserve (Idempotency-Key), POST /reservations/{id}/pay, GET /reservations/{id}.`,
        `Mô hình dữ liệu: reservations(id, sku, user_id UNIQUE với sku, status, expires_at), orders, outbox; Redis: stock:{sku} (int), buyers:{sku} (set), token theo user.`,
        `Trang sản phẩm và phần còn lại của site đi đường khác (cache/CDN) để không bị kéo sập.`
      ],
      hint: `Nguyên tắc: càng gần user càng rẻ. CDN chặn traffic xem; gate chặn traffic bấm; Redis quyết định có hàng; DB chỉ ghi kết quả. Nói rõ Redis là **nguồn sự thật về kho trong lúc bán**, DB là nguồn sự thật sau khi bán — và cách hai bên đối soát. Vẽ job hết hạn hoàn kho ngay trên sơ đồ, đừng để bị hỏi mới nhớ.`
    },
    deep: {
      checks: [
        `Atomic "trừ kho + đánh dấu user đã mua" trong 1 script Lua; giải thích vì sao 2 lệnh rời (GET rồi DECR) sai.`,
        `Idempotent reserve: Idempotency-Key + unique (sku, user_id); retry sau timeout không tạo 2 giữ chỗ và không trừ kho 2 lần.`,
        `Queue gate: token có chữ ký (HMAC) hoặc lưu Redis, phát theo tốc độ cố định; phân biệt "chờ" (202) và "hết" (409) để client ngừng spam.`,
        `Chống bot: xác thực trước giờ bán, 1 tài khoản/thiết bị/số điện thoại, CAPTCHA khi vào hàng đợi, rate limit theo IP+user, phát hiện pattern (cùng device fingerprint).`,
        `Redis chết giữa chừng: AOF everysec/replica + reconcile với DB (sold = count reservation active) trước khi mở lại; chấp nhận dừng bán vài giây thay vì oversell.`,
        `Hết hạn giữ chỗ: job quét expires_at (index partial status=reserved) hoặc Redis keyspace notification; INCR trả kho + mở cho người trong hàng đợi.`
      ],
      hint: `Điểm xoáy chắc chắn: "Hai request cùng lúc với 1 đơn vị cuối cùng thì sao?" → Lua atomic. "Client timeout rồi gửi lại?" → idempotency key. "Redis mất dữ liệu?" → nguồn sự thật, đối soát, fail-closed (dừng bán). "Bot mua hết trong 1 giây?" → gate + định danh mạnh + random hóa thứ tự nhẹ trong hàng đợi. Với mỗi điểm, nêu 2 phương án rồi chọn.`
    },
    wrap: {
      checks: [
        `Tóm tắt bất biến và cách bảo vệ nó ở từng tầng (gate, Lua, unique constraint).`,
        `Trade-off đã chọn: fail-closed khi Redis lỗi (chấp nhận dừng bán), gần công bằng thay vì FIFO, undersell tạm thời thay vì oversell.`,
        `Điều sẽ làm nếu có thêm thời gian: sharding theo SKU, pre-allocate kho theo region, load test với 2M user ảo.`,
        `Rủi ro còn lại: bot tinh vi, PSP chậm làm giữ chỗ hết hạn hàng loạt.`
      ],
      hint: `Kết bằng 3 câu: bất biến, nơi bảo vệ bất biến, cái gì bạn chủ động hy sinh. Đừng mở thêm ý mới ở phút cuối.`
    }
  },
  followups: [
    `What happens if two requests race for the last unit? Walk me through the exact sequence.`,
    `The client times out after calling reserve and retries. How do you avoid double-reserving or double-decrementing?`,
    `Redis crashes 20 seconds into the sale. What do you do, and how do you know how many units are really sold?`,
    `How do you keep bots from buying everything in the first second?`,
    `Would you use a database row lock (SELECT FOR UPDATE) instead of Redis? Why or why not at this scale?`,
    `How does the waiting room decide the order of users, and is that fair?`,
    `Payment takes up to 10 minutes. How do you release unpaid reservations without overselling in the meantime?`,
    `How would you extend this to 1,000 SKUs on sale at once?`,
    `How do you load-test this before the real sale?`
  ],
  rubric_notes: `### Câu trả lời mạnh có gì
- Nói rõ bất biến (sold ≤ stock) và chỉ ra **ba lớp** bảo vệ: gate giảm tải, Lua atomic quyết định, unique constraint trong DB làm lưới cuối.
- Phễu số liệu: 2M → ~20k/s qua gate → 10k thành công; nhấn mạnh thiết kế để từ chối rẻ.
- Idempotency được nhắc **trước khi** bị hỏi; phân biệt retry của client và redelivery của queue.
- Có kế hoạch cho Redis chết: fail-closed + đối soát, không nói "Redis không chết đâu".
- Chống bot là phần thiết kế, có nhiều lớp (định danh trước, CAPTCHA ở gate, rate limit, fingerprint).
### Bẫy thường gặp
- Đặt Postgres làm nơi trừ kho với SELECT FOR UPDATE ở 100k RPS → lock contention, chết ngay giây đầu.
- Dùng 2 lệnh Redis rời (GET rồi DECR) → race → oversell.
- Quên hoàn kho khi giữ chỗ hết hạn → undersell vĩnh viễn, PO sẽ hỏi "còn 2 000 cái đâu".
- Hứa FIFO tuyệt đối ở quy mô này — không ai làm được và không cần.
### Dấu hiệu senior
- Chủ động nói "tôi hy sinh gì": công bằng tuyệt đối, availability của nút mua khi Redis lỗi.
- Nhắc đến load test và kịch bản diễn tập trước ngày bán như một phần của thiết kế.`,
  reference: `### Yêu cầu chốt
- Functional: giữ chỗ 1 đơn vị/người/SKU, không oversell, giữ chỗ TTL 10 phút rồi thanh toán, hoàn kho khi hết hạn, hàng đợi khi quá tải, chặn bot.
- Non-functional: đỉnh ~100k RPS vào nút mua, trả lời được/hết/chờ trong < 1 s p99, phần còn lại của site không bị ảnh hưởng; consistency mạnh cho kho, eventual cho mọi thứ khác (thống kê, email).
### Ước lượng
| Đại lượng | Tính | Kết quả |
|---|---|---|
| RPS trung bình phút đầu | 2M / 60 | ~33k RPS |
| RPS đỉnh (nửa số người trong 5 s đầu) | 1M / 5 | ~200k RPS trước gate, gate cho qua 20k/s |
| Tỉ lệ thành công | 10k / 2M | 0,5% |
| Lệnh Redis | 20k/s Lua + đọc trạng thái | 1 node đủ (100k ops/s), có replica |
| Ghi Postgres | 10k reservation + 10k order trong 10 phút | ~35 TPS, không đáng kể |
### Thiết kế tổng thể
:::diagram
User[Browser/App] -> CDN[CDN trang chờ + đếm ngược]
User -> Gate[Queue gate cấp token] : vào hàng đợi
Gate -> API[Order API stateless] : token hợp lệ
API -> Inv[Redis stock + buyers set] : Lua atomic
API -> DB[Postgres reservations/orders] : insert + outbox
DB -> Relay[Outbox relay]
Relay -> MQ[Queue]
MQ -> PayW[Payment worker]
PayW -> PSP[Payment provider]
Exp[Expiry job] -> DB : hủy giữ chỗ hết hạn
Exp -> Inv : INCR trả kho
:::
- Luồng chính: user vào hàng đợi (POST /queue/enter) → gate phát token theo tốc độ cố định (20k/s) → POST /sale/{sku}/reserve với token + Idempotency-Key → API chạy Lua: nếu user đã có trong buyers thì trả reservation cũ; nếu stock > 0 thì DECR + SADD và trả OK; ngược lại trả hết hàng → API insert reservation (status reserved, expires_at) + outbox → client thanh toán trong 10 phút → worker confirm → order.
- API chính: POST /queue/enter; GET /queue/status; POST /sale/{sku}/reserve; POST /reservations/{id}/pay; GET /reservations/{id}.
- Dữ liệu: reservations(id ULID, sku, user_id, status, expires_at, idem_key) với UNIQUE(sku, user_id) và partial index (expires_at) WHERE status = reserved; Redis stock:{sku} int, buyers:{sku} set, gate:token:{user} TTL ngắn.
### Đào sâu
**1. Trừ kho atomic.** Lua nhận KEYS stock, buyers và ARGV user: kiểm tra SISMEMBER → trả 2 (đã mua); GET stock ≤ 0 → trả 0; DECR + SADD → trả 1. Một script = một đơn vị, không có cửa sổ giữa đọc và ghi. So với SELECT FOR UPDATE trên row stock: đúng nhưng mọi request xếp hàng sau một row lock → vài trăm TPS, không phải 20k.
**2. Idempotent reserve.** Idempotency-Key do client sinh; server lưu (key → reservation_id) trong Redis 15 phút và UNIQUE(sku, user_id) trong DB. Retry sau timeout: Lua thấy user trong buyers → trả reservation cũ, DB không insert thêm. Lưới cuối là unique constraint — nếu mọi thứ trên đều sai, DB vẫn từ chối bản thứ hai.
**3. Redis lỗi.** Nguồn sự thật về kho trong lúc bán là Redis; DB là bản ghi kết quả. Redis có replica + AOF everysec. Khi failover có thể mất ≤ 1 s lệnh: trước khi mở lại bán, đối soát stock = 10 000 − count(reservations WHERE status IN (reserved, paid)) và ghi lại Redis. Trong lúc đối soát API trả 503 "tạm dừng" — fail-closed, chấp nhận dừng 10–30 s thay vì oversell.
**4. Chống bot.** Xác thực số điện thoại trước giờ bán (chặn tạo tài khoản hàng loạt); CAPTCHA tại POST /queue/enter; token gate gắn user + device, HMAC ký, dùng 1 lần; rate limit IP+user; thứ tự trong hàng đợi random hóa trong các cửa sổ 1 s để script "bấm sớm 1 ms" không có lợi thế.
### Trade-off
| Lựa chọn | Được | Mất |
|---|---|---|
| Redis quyết định kho | 20k quyết định/s, 1 round trip | Phải đối soát với DB, fail-closed khi Redis lỗi |
| Gate theo tốc độ cố định | Bảo vệ Redis/DB, UX rõ ràng (bạn ở vị trí N) | Không FIFO tuyệt đối, thêm 1 thành phần |
| Giữ chỗ TTL 10 phút | Không oversell dù PSP chậm | Undersell tạm thời, cần job hoàn kho |
| Fail-closed | Không bao giờ bán quá | Mất doanh thu vài chục giây khi sự cố |
### Nói thế nào trong phỏng vấn (EN)
- "The one invariant I will not trade is sold ≤ stock; everything else — fairness, latency for the losers — is negotiable." — Bất biến duy nhất không đổi là không bán quá kho.
- "Only 0.5% of requests can ever succeed, so the design is about rejecting the other 99.5% as cheaply as possible." — Thiết kế xoay quanh việc từ chối rẻ.
- "Redis is the source of truth during the sale, Postgres after it, and I reconcile between them on failover." — Redis là chân lý lúc bán, DB sau đó, có đối soát.`
});
window.MOCKS.push({
  id: 'X2',
  title: 'Design a collaborative document editor (Google Docs)',
  level: 3,
  prompt: `Design a real-time collaborative document editor like Google Docs: multiple users edit the same document simultaneously, everyone sees changes within a second, no edits are lost, and users can see each other's cursors.
Thiết kế trình soạn thảo cộng tác thời gian thực kiểu Google Docs: nhiều người cùng sửa một tài liệu, mọi người thấy thay đổi trong vòng 1 giây, không mất thao tác, thấy con trỏ của nhau.`,
  clarify: [
    `Hỏi: Bao nhiêu người cùng sửa một tài liệu? → Đáp: Thường 2–10, tối đa 100 đồng thời; tài liệu đến vài MB text.`,
    `Hỏi: Loại nội dung? → Đáp: Rich text (đoạn, in đậm, heading); bảng/ảnh ngoài phạm vi.`,
    `Hỏi: Có cần offline editing không? → Đáp: Có, mức cơ bản: mất mạng vài phút rồi nối lại vẫn merge được.`,
    `Hỏi: Lịch sử phiên bản và undo? → Đáp: Cần xem lịch sử theo thời điểm; undo cục bộ của người dùng, không cần undo chung.`,
    `Hỏi: Độ trễ chấp nhận? → Đáp: Thao tác của người khác hiện trong < 500 ms cùng khu vực; con trỏ/presence có thể trễ hơn.`,
    `Hỏi: Quy mô? → Đáp: 10 triệu tài liệu, 1 triệu người dùng hoạt động/ngày, 100k phiên sửa đồng thời.`,
    `Hỏi: Có cần consistency tuyệt đối giữa các client sau khi yên lặng không? → Đáp: Có — convergence là bắt buộc.`
  ],
  phases: {
    req: {
      checks: [
        `Chốt bất biến: mọi client hội tụ về cùng nội dung sau khi hết thao tác (convergence), không mất thao tác.`,
        `Phân biệt hai luồng: nội dung (bền, có thứ tự) và presence/cursor (ephemeral, mất cũng được).`,
        `Non-functional: < 500 ms lan truyền, 100 người/tài liệu, 100k phiên đồng thời, offline vài phút.`,
        `Lịch sử phiên bản là yêu cầu chức năng ảnh hưởng mô hình lưu trữ (op log + snapshot).`,
        `Ngoài phạm vi: ảnh/bảng, quyền chia sẻ chi tiết, comment.`
      ],
      hint: `Hỏi ngay "cần offline không" và "bao nhiêu người cùng lúc" — hai câu này quyết định OT (server trung tâm, thứ tự toàn cục) hay CRDT (merge không cần server). Tách nội dung khỏi presence sớm để không thiết kế quá tay cho con trỏ.`
    },
    est: {
      checks: [
        `100k phiên × ~2 thao tác/s/người đang gõ (chỉ ~30% gõ cùng lúc) ≈ 60k op/s vào hệ thống.`,
        `Mỗi op ~100 B (kiểu, vị trí, ký tự, version) → ~6 MB/s ghi op log; 1 ngày ≈ 500 GB op thô nếu không nén/snapshot.`,
        `Fan-out: mỗi op gửi cho N−1 người cùng tài liệu; với trung bình 3 người → ~120k message/s đi ra.`,
        `WebSocket: 100k kết nối đồng thời (~1 triệu người/ngày nhưng không đồng thời) → 5–10 node gateway (10–20k kết nối/node).`,
        `Snapshot mỗi 100–500 op hoặc 1 phút để mở tài liệu không phải replay cả ngày.`
      ],
      hint: `Đừng tính "1 triệu người × 10 op/s". Chỉ người đang gõ mới sinh op, và chỉ trong thời gian gõ. Số quan trọng để nói to: op/s vào, message/s ra (fan-out), kết nối đồng thời, và tốc độ phình của op log → lý do cần snapshot.`
    },
    hld: {
      checks: [
        `Sơ đồ: client ↔ WebSocket gateway ↔ document service (1 "chủ" mỗi tài liệu) ↔ op log (Kafka/Redis Stream hoặc Postgres append) + snapshot store (S3/DB) + presence (Redis pub/sub).`,
        `Mỗi tài liệu được route về một instance (consistent hashing theo doc_id) để có thứ tự toàn cục cho OT; hoặc CRDT thì không cần chủ nhưng cần merge.`,
        `API: WS join(doc_id, since_version), op(doc_id, base_version, ops), ack(version), cursor(pos); REST GET /docs/{id}?version=.`,
        `Mô hình dữ liệu: documents(id, head_version, snapshot_ref), ops(doc_id, version, user_id, op, ts) append-only, snapshots(doc_id, version, blob).`,
        `Luồng ghi: client gửi op kèm base_version → server transform theo op đã có từ base_version → gán version mới → append log → broadcast → ack.`
      ],
      hint: `Trung tâm của sơ đồ là "ai quyết định thứ tự op cho một tài liệu". Với OT: một node chủ per doc (dễ hiểu, chuẩn Google Docs). Với CRDT: mọi node merge được, trả giá bằng metadata lớn hơn. Chọn một, nêu lý do theo yêu cầu offline và số người. Presence đi Redis pub/sub riêng, không ghi log.`
    },
    deep: {
      checks: [
        `OT vs CRDT: giải thích transform (op đến muộn phải dịch vị trí) vs CRDT (id duy nhất mỗi ký tự, merge giao hoán); ưu/nhược về metadata, offline, độ phức tạp.`,
        `Snapshot + op log: mở tài liệu = snapshot gần nhất + replay op sau đó; chính sách compaction; xem lịch sử tại version V.`,
        `Failover của node chủ tài liệu: op log là nguồn sự thật, node mới replay từ snapshot; client gửi lại op chưa ack theo base_version; dedup theo (client_id, seq).`,
        `WebSocket scale: sticky theo doc_id ở gateway, route nội bộ; reconnect với since_version; heartbeat và backpressure khi client chậm.`,
        `Presence: Redis pub/sub channel per doc, TTL 30 s, mất cũng được; không trộn với op log.`,
        `Offline: client giữ hàng đợi op cục bộ với base_version, khi nối lại server transform (OT) hoặc merge (CRDT); giới hạn độ dài offline để transform không bùng nổ.`
      ],
      hint: `Khi bị hỏi "OT hay CRDT", trả lời bằng yêu cầu: offline vài phút + ≤100 người + cần server để lưu lịch sử → OT với server trung tâm là đủ và đơn giản hơn; CRDT (Yjs/Automerge) khi P2P hoặc offline dài. Điểm xoáy thứ hai luôn là "node chủ chết thì sao" → op log bền + replay + client resend idempotent.`
    },
    wrap: {
      checks: [
        `Tóm tắt lựa chọn OT (hoặc CRDT) và lý do gắn với yêu cầu.`,
        `Bảo đảm không mất op: log bền trước khi ack, client resend theo seq, dedup server.`,
        `Trade-off đã chấp nhận: presence best-effort; độ trễ cao hơn cho người ở xa node chủ.`,
        `Việc làm thêm: multi-region với node chủ gần người tạo, nén op log, permission.`
      ],
      hint: `Kết: "Một node chủ mỗi tài liệu cho thứ tự, op log bền cho không mất, snapshot cho mở nhanh, presence tách riêng." Bốn vế, mỗi vế một câu.`
    }
  },
  followups: [
    `Why did you choose OT over CRDT (or the other way around)? What would make you switch?`,
    `The node that owns a document crashes mid-edit. What do clients experience and how do you recover without losing edits?`,
    `How do you show the document as it was at 10:32 yesterday?`,
    `Two users insert at the same position at the same time. What ends up in the document and why is it the same on both screens?`,
    `How do you scale WebSocket connections across many servers while keeping one owner per document?`,
    `A user is offline for 20 minutes and made 500 edits. What happens when they reconnect?`,
    `How do cursors and presence work, and why not store them in the op log?`,
    `What is the cost of a 10 MB document with 100 editors, and where does it break first?`
  ],
  rubric_notes: `### Câu trả lời mạnh có gì
- Tách bạch hai lớp: nội dung (ordered, durable) và presence (ephemeral); không thiết kế quá tay cho con trỏ.
- Chọn OT hoặc CRDT **theo yêu cầu** (offline, số người, nhu cầu server lưu lịch sử), nói được giá của mỗi bên (OT: server trung tâm, transform phức tạp; CRDT: metadata/tombstone lớn).
- Op log là nguồn sự thật, snapshot là tối ưu; failover = replay; client resend idempotent theo (client_id, seq).
- Biết route theo doc_id (consistent hashing) để một tài liệu có một chủ.
### Bẫy thường gặp
- Nói "dùng CRDT là xong" mà không giải thích convergence hay tombstone phình.
- Lưu cả tài liệu mỗi lần gõ (ghi MB mỗi phím) hoặc ngược lại chỉ lưu op mà không snapshot (mở tài liệu replay cả triệu op).
- Quên reconnect/offline: client mất mạng 30 s và mất hết thao tác.
- Trộn presence vào op log → log phình gấp 10 lần vô ích.
### Dấu hiệu senior
- Nhắc "last-writer-wins là mất dữ liệu" và vì sao editor không dùng được nó.
- Đưa ra giới hạn (độ dài offline tối đa, số người tối đa) như quyết định sản phẩm, không như hạn chế kỹ thuật.`,
  reference: `### Yêu cầu chốt
- Functional: nhiều người sửa đồng thời, hội tụ về cùng nội dung, không mất thao tác, lịch sử theo thời điểm, cursor/presence, offline vài phút.
- Non-functional: lan truyền < 500 ms cùng khu vực, ≤ 100 người/tài liệu, 100k phiên đồng thời, 10 triệu tài liệu, durability cho op đã ack.
### Ước lượng
| Đại lượng | Tính | Kết quả |
|---|---|---|
| Op vào | 100k phiên × 30% đang gõ × 2 op/s | ~60k op/s |
| Op log | 60k × 100 B | ~6 MB/s ≈ 500 GB/ngày thô |
| Fan-out ra | 60k × (3 − 1) người | ~120k msg/s |
| Kết nối WS | 100k đồng thời | 5–10 gateway node |
| Snapshot | mỗi 200 op hoặc 60 s | mở tài liệu replay ≤ 200 op |
### Thiết kế tổng thể
:::diagram
C1[Client A] -> GW[WebSocket gateway]
C2[Client B] -> GW
GW -> DocSvc[Document service - 1 chủ mỗi doc] : route theo doc_id
DocSvc -> Log[Op log append-only] : append trước khi ack
DocSvc -> Snap[Snapshot store S3/DB] : mỗi 200 op
DocSvc -> GW : broadcast op đã gán version
GW -> Pres[Presence Redis pub/sub] : cursor, online
Hist[History API] -> Snap
Hist -> Log
:::
- Luồng ghi: client gửi op(base_version, seq) → gateway route tới node chủ của doc (consistent hashing theo doc_id) → node transform op theo các op đã có từ base_version (OT) → gán version = head + 1 → append log (bền) → ack client gửi + broadcast cho client khác → client khác transform op với op cục bộ chưa ack rồi áp dụng.
- Luồng đọc/mở: GET snapshot gần nhất + op từ snapshot.version → head; client join WS với since_version để nhận phần còn thiếu.
- Dữ liệu: documents(id, head_version, last_snapshot_version); ops(doc_id, version, client_id, seq, op jsonb, ts) PK (doc_id, version), UNIQUE (doc_id, client_id, seq) để dedup; snapshots(doc_id, version, blob_ref).
### Đào sâu
**1. OT vs CRDT.** OT: op là insert(pos, text)/delete(pos, len); server là điểm thứ tự duy nhất, transform op đến muộn theo op đã áp dụng (dịch vị trí). Đơn giản hóa nhờ có server, metadata nhỏ, lịch sử tự nhiên. CRDT (RGA/Yjs): mỗi ký tự có id duy nhất (client, counter), insert tham chiếu id hàng xóm → merge giao hoán, không cần server thứ tự, offline dài tốt; giá là tombstone và metadata (×2–×10 kích thước) và lịch sử theo thời điểm khó hơn. Với yêu cầu này (≤ 100 người, offline vài phút, cần lịch sử) → OT với server trung tâm.
**2. Durability và failover.** Op chỉ được ack sau khi append log thành công (Kafka acks=all hoặc Postgres commit). Node chủ chết: gateway route doc sang node khác (ring), node mới load snapshot + replay op → head_version; client reconnect gửi lại op chưa ack theo (client_id, seq); UNIQUE (doc_id, client_id, seq) chặn trùng. Client thấy "đang kết nối lại" 1–3 s, không mất gì.
**3. Snapshot và lịch sử.** Compaction: mỗi 200 op hoặc 60 s ghi snapshot; xem tại version V = snapshot ≤ V + replay. Op log giữ 30 ngày đầy đủ, sau đó chỉ giữ snapshot theo giờ. Undo cục bộ = inverse op của chính user, cũng đi qua OT.
**4. WebSocket và presence.** Gateway stateless về nội dung, chỉ giữ kết nối; nội bộ route theo doc_id. Heartbeat 30 s; client chậm → gateway coalesce op (gộp N op thành 1 message) thay vì buffer vô hạn. Presence qua Redis pub/sub channel doc:{id}, TTL 30 s, không lưu.
### Trade-off
| Lựa chọn | Được | Mất |
|---|---|---|
| OT + node chủ | Thứ tự rõ, metadata nhỏ, lịch sử dễ | Node chủ là điểm nghẽn/latency cho người ở xa |
| Op log + snapshot | Không mất op, mở nhanh | Hai nơi lưu, cần compaction |
| Presence tách riêng | Log không phình, mất presence vô hại | Hai đường truyền phải đồng bộ UI |
| Giới hạn offline vài phút | Transform đơn giản | Người offline lâu phải merge tay |
### Nói thế nào trong phỏng vấn (EN)
- "The core problem is ordering: every document needs exactly one place that decides the sequence of operations." — Vấn đề cốt lõi là thứ tự op.
- "I ack an edit only after it is durably appended to the op log, so a crash never loses acknowledged work." — Chỉ ack sau khi log bền.
- "Presence is best-effort and lives in Redis pub/sub; losing a cursor position is fine, losing a keystroke is not." — Presence best-effort, nội dung thì không.`
});
window.MOCKS.push({
  id: 'X3',
  title: 'Design a log aggregation and search platform (ELK-like)',
  level: 2,
  prompt: `Design a centralized logging platform for a company with ~2,000 services: collect logs from every container, make them searchable within 30 seconds, keep 30 days hot and 1 year cold, and isolate teams from each other.
Thiết kế nền tảng log tập trung cho ~2 000 service: thu log từ mọi container, tìm kiếm được trong 30 giây, giữ 30 ngày nóng và 1 năm lạnh, cô lập giữa các team.`,
  clarify: [
    `Hỏi: Lưu lượng log? → Đáp: ~50 TB/ngày thô, đỉnh gấp 3 khi sự cố; dòng log trung bình 500 B.`,
    `Hỏi: Kiểu truy vấn? → Đáp: Full-text theo khoảng thời gian + lọc theo field (service, level, trace_id); tổng hợp đơn giản (count theo phút).`,
    `Hỏi: Độ trễ chấp nhận từ lúc ghi đến lúc tìm được? → Đáp: ≤ 30 s bình thường; khi sự cố có thể chậm hơn nhưng không được mất log.`,
    `Hỏi: Log có cấu trúc chưa? → Đáp: ~60% JSON, còn lại text; cần parse/enrich (thêm k8s pod, team).`,
    `Hỏi: Cô lập team nghĩa là gì? → Đáp: Team chỉ thấy log của mình; một team spam log không được làm chậm team khác; quota theo team.`,
    `Hỏi: Retention và pháp lý? → Đáp: 30 ngày tìm được ngay, 1 năm lưu lạnh có thể truy vấn chậm (phút–giờ); một số field PII phải che.`,
    `Hỏi: Chi phí có là ràng buộc? → Đáp: Có — giảm chi phí lưu trữ là mục tiêu thứ hai sau không mất log.`
  ],
  phases: {
    req: {
      checks: [
        `Functional: thu thập mọi container, parse/enrich, tìm full-text + lọc field theo thời gian, dashboard count, quota và cô lập theo team, che PII.`,
        `Non-functional: 50 TB/ngày (đỉnh 150), độ trễ ≤ 30 s, không mất log khi backend chậm, 30 ngày nóng/1 năm lạnh.`,
        `Phân biệt "không mất" (durability ở buffer) với "tìm được ngay" (có thể trễ khi sự cố).`,
        `Cô lập có hai nghĩa: quyền truy cập và tài nguyên (noisy neighbor).`,
        `Ngoài phạm vi: metrics/tracing (chỉ cần trace_id để liên kết), alerting phức tạp.`
      ],
      hint: `Hỏi ngay số TB/ngày và kích thước dòng — mọi quyết định sau đều từ đó. Hỏi "mất log có chấp nhận không" để biết cần buffer bền (Kafka) hay chỉ cần best-effort. Hỏi cô lập là quyền hay tài nguyên hay cả hai.`
    },
    est: {
      checks: [
        `50 TB / 86 400 s ≈ 580 MB/s ≈ 1,2 triệu dòng/s (500 B); đỉnh ~1,7 GB/s.`,
        `Kafka: 580 MB/s → ~60–100 partition (10 MB/s mỗi partition), replication ×3 → ~1,7 GB/s ghi đĩa; giữ 24 h buffer = ~4 TB × 3.`,
        `Elasticsearch: 50 TB thô → index + replica ×1 ≈ 60–100 TB/ngày (index phình) → 30 ngày ≈ 2–3 PB nếu không nén/tiering → cần hot/warm/cold và chỉ index field cần thiết.`,
        `Shard 30–50 GB → ~1 500–3 000 shard/ngày; indexer cần ~100–200 node ES data cho hot.`,
        `Cold 1 năm: object storage nén 5–10× → ~2–3 PB S3; truy vấn bằng rehydrate hoặc query trực tiếp (searchable snapshot).`
      ],
      hint: `Nói to con số 580 MB/s và 1,2 triệu dòng/s — nó giải thích vì sao cần Kafka ở giữa và vì sao không thể index mọi field. Chỉ ra "index phình 1,2–2× so với thô" và "replica ×2" để ra con số PB, rồi dùng tiering giảm xuống.`
    },
    hld: {
      checks: [
        `Sơ đồ: agent trên node (Fluent Bit/Vector) → Kafka (topic theo team/tier) → stream processor parse/enrich/mask → indexer → ES hot (SSD) → warm → cold (S3 searchable snapshot); query API + UI; archive thô ra S3.`,
        `Kafka là buffer bền: ES chậm/sập thì log tích trong Kafka, không mất; lag là metric chính.`,
        `Index theo thời gian + team (logs-{team}-{yyyy.MM.dd}), ILM rollover theo kích thước; alias theo team để search.`,
        `API: POST /ingest (cho agent không dùng Kafka), GET /search?team&from&to&q&filters, GET /fields, quota API.`,
        `Mô hình dữ liệu: document log {ts, team, service, level, msg, trace_id, k8s.*, attrs}; chỉ index ~10 field, msg full-text, attrs dynamic:false.`
      ],
      hint: `Vẽ Kafka ở giữa và nói "đây là nơi tôi mua sự an toàn": agent chỉ cần ghi được vào Kafka. Phân tầng hot/warm/cold trên sơ đồ. Nói rõ index naming theo team + ngày — nó vừa là cô lập quyền, vừa là đơn vị retention.`
    },
    deep: {
      checks: [
        `Cardinality và mapping explosion: attrs dynamic:false, giới hạn field 200, trace_id keyword, không index user_id dạng text; nêu vì sao field bùng nổ làm ES OOM.`,
        `Hot/warm/cold + ILM: hot SSD 2–3 ngày, warm HDD đến 30 ngày (force merge, 0 replica hoặc 1), cold searchable snapshot trên S3; chi phí giảm 5–10×.`,
        `Noisy neighbor: topic/partition theo tier team, quota byte/s ở agent và Kafka, index riêng theo team, ES shard allocation theo tier, backpressure về agent khi vượt quota (drop có đếm hoặc sampling debug log).`,
        `Không mất log: agent có disk buffer, Kafka acks=all, consumer commit sau khi ES bulk thành công, retry bulk với backoff; DLQ cho document không parse được.`,
        `PII masking ở stream processor trước khi vào index; audit truy vấn.`,
        `Truy vấn: giới hạn khoảng thời gian mặc định, async search cho cold, cache theo query hash; search chậm của một team không chiếm hết thread pool (dedicated coordinating node hoặc search quota).`
      ],
      hint: `Điểm xoáy kinh điển: "ES chết 1 giờ thì sao" → Kafka giữ, lag tăng, replay. "Một team log 10× bình thường" → quota + partition riêng + index riêng. "Tại sao không index mọi field" → mapping explosion/cardinality. "Chi phí" → tiering + chỉ hot 2–3 ngày.`
    },
    wrap: {
      checks: [
        `Tóm tắt: Kafka mua độ bền và hấp thụ đỉnh; ES tiering mua chi phí; index theo team mua cô lập.`,
        `Trade-off đã chọn: trễ 30 s thay vì real-time; cold query mất phút; drop/sampling debug log khi vượt quota có đếm.`,
        `Metric vận hành: Kafka consumer lag, ES indexing rejections, shard count, disk watermark, quota drop theo team.`,
        `Việc làm thêm: ClickHouse/Loki như phương án rẻ hơn cho log có cấu trúc; tracing liên kết.`
      ],
      hint: `Kết bằng ba từ khóa: buffer bền, tiering, cô lập theo team. Nêu metric số 1 là consumer lag.`
    }
  },
  followups: [
    `Elasticsearch is down for an hour. What happens to the logs produced in that hour?`,
    `One team suddenly logs 20x their normal volume. How do you keep other teams unaffected?`,
    `Why not index every JSON field so people can filter on anything?`,
    `How do you keep 30 days searchable without paying for 3 PB of SSD?`,
    `A developer searches for a request across 10 services by trace_id. How does that query run and how fast is it?`,
    `How do you guarantee a team cannot read another team's logs, including via the API?`,
    `Would ClickHouse or Loki be a better fit than Elasticsearch here? When?`,
    `How do you handle logs that contain personal data?`
  ],
  rubric_notes: `### Câu trả lời mạnh có gì
- Đưa Kafka vào làm buffer bền và giải thích nó mua gì: không mất log khi ES chậm, hấp thụ đỉnh ×3, replay.
- Con số rõ: 580 MB/s, 1,2 triệu dòng/s, index phình 1,5–2×, tiering giảm chi phí 5–10×.
- Nói về cardinality/mapping explosion như rủi ro số 1 của ES và cách chặn (dynamic:false, giới hạn field).
- Cô lập hai chiều: quyền (index per team + alias + RBAC) và tài nguyên (quota, partition, shard allocation).
- Metric vận hành: consumer lag, indexing rejections, shard count.
### Bẫy thường gặp
- Agent ghi thẳng vào ES → ES chậm là mất log hoặc agent OOM.
- Index mọi field → mapping explosion, heap ES vỡ.
- Một index khổng lồ cho tất cả → không retention theo team, không cô lập, shard quá lớn.
- Quên chi phí: 30 ngày × 100 TB trên SSD là con số không ai duyệt.
### Dấu hiệu senior
- Chủ động so sánh với Loki/ClickHouse và nói khi nào ES không phải lựa chọn tốt.
- Nêu "drop có đếm" (sampling debug log, metric dropped_total theo team) như một quyết định thay vì giấu.`,
  reference: `### Yêu cầu chốt
- Functional: thu log mọi container; parse/enrich (k8s metadata, team); full-text + lọc field theo thời gian; count theo phút; quota và cô lập team; che PII; 30 ngày nóng, 1 năm lạnh.
- Non-functional: 50 TB/ngày (đỉnh 150), tìm được trong ≤ 30 s, không mất log khi backend chậm, chi phí là ràng buộc thứ hai.
### Ước lượng
| Đại lượng | Tính | Kết quả |
|---|---|---|
| Throughput | 50 TB / 86 400 s | ~580 MB/s, ~1,2 triệu dòng/s; đỉnh 1,7 GB/s |
| Kafka partition | 1,7 GB/s / 10–20 MB/s | ~100–170 partition, replication ×3, giữ 24 h ≈ 12 TB |
| ES hot | 50 TB × 1,5 (index) × 2 (replica) | ~150 TB/ngày; hot 3 ngày ≈ 450 TB SSD |
| Warm 27 ngày | 50 × 1,5 × 1 (1 bản) × 27 | ~2 PB HDD (force merge, nén) |
| Cold 1 năm | 50 TB × 365 / nén 8× | ~2,3 PB S3 |
| Shard | 50 GB mỗi shard | ~3 000 shard/ngày → rollover theo kích thước |
### Thiết kế tổng thể
:::diagram
Agent[Agent Fluent Bit/Vector trên mỗi node] -> Kafka[Kafka topic theo team-tier] : disk buffer, acks=all
Kafka -> Proc[Stream processor parse/enrich/mask]
Proc -> Idx[Indexer bulk]
Idx -> Hot[ES hot SSD 3 ngày]
Hot -> Warm[ES warm HDD đến 30 ngày] : ILM rollover
Warm -> Cold[S3 searchable snapshot 1 năm]
Proc -> Arch[S3 archive thô nén]
Proc -> DLQ[DLQ unparseable]
UI[Search UI/API] -> Hot
UI -> Warm
UI -> Cold : async search
:::
- Luồng ghi: agent tail stdout → gắn k8s metadata → ghi Kafka topic theo team-tier (disk buffer local khi Kafka chậm) → processor parse JSON, chuẩn hóa field, che PII, gắn team → bulk index 5–10 MB/batch vào index logs-{team}-{ngày}; commit offset sau khi bulk OK.
- Luồng đọc: UI chọn team (RBAC → alias), khoảng thời gian bắt buộc, query full-text + filter; ILM quyết định index nằm tier nào; cold chạy async search.
- Dữ liệu: document {ts, team, service, env, level, msg (text), trace_id (keyword), k8s.pod, k8s.ns, attrs (object, dynamic:false)}; mapping giới hạn 200 field; index per team per ngày; alias logs-{team}.
### Đào sâu
**1. Không mất log.** Agent có disk buffer 1–5 GB/node; Kafka acks=all, replication 3, retention 24–48 h; consumer commit offset chỉ sau bulk thành công; bulk reject (429 từ ES) → backoff, lag tăng, không drop. ES chết 1 giờ = 2 TB chờ trong Kafka, replay với tốc độ gấp 2–3 bình thường trong 30–60 phút. Metric số 1: consumer lag theo topic.
**2. Cardinality và mapping.** Mỗi field mới = 1 mapping entry trong cluster state, lan ra mọi node; attrs dynamic → hàng chục nghìn field → heap vỡ, cluster state update chậm. Giải pháp: dynamic:false cho attrs (lưu nhưng không index), whitelist 10–20 field index, trace_id/user_id là keyword không text, giới hạn field per index. Team cần field mới thì đăng ký qua schema registry nhẹ.
**3. Noisy neighbor và quota.** Quota byte/s theo team cấu hình ở agent (drop debug trước, đếm dropped_total{team}) và ở Kafka (producer quota). Team lớn có partition và index riêng; ES shard allocation awareness theo tier; search có timeout và giới hạn khoảng thời gian mặc định 15 phút; coordinating node riêng cho search để indexing không bị đói thread.
**4. Chi phí bằng tiering.** Hot 3 ngày SSD (replica 1), warm đến 30 ngày HDD (force merge 1 segment, 0 replica + snapshot để phục hồi), cold S3 searchable snapshot (truy vấn phút). Tổng chi phí giảm ~5–8× so với toàn SSD. Archive thô nén zstd ra S3 song song để tái index khi đổi mapping.
### Trade-off
| Lựa chọn | Được | Mất |
|---|---|---|
| Kafka ở giữa | Không mất log, hấp thụ đỉnh, replay | Thêm cluster phải vận hành, trễ thêm vài giây |
| Index per team per ngày | Cô lập quyền và retention, shard hợp lý | Nhiều index/shard, cần ILM kỷ luật |
| dynamic:false | Mapping ổn định, heap an toàn | Không lọc được field tùy ý, cần đăng ký |
| Tiering | Chi phí giảm 5–8× | Query cũ chậm, phức tạp vận hành |
### Nói thế nào trong phỏng vấn (EN)
- "Kafka is where I buy durability: as long as the agent can write to Kafka, we never lose a log line, even if Elasticsearch is down for an hour." — Kafka là nơi mua độ bền.
- "The number one way to kill an Elasticsearch cluster is mapping explosion, so I index a fixed set of fields and store the rest." — Chặn mapping explosion bằng whitelist field.
- "Isolation means two things here: who can read, and who can slow down whom — I handle both with per-team indices and per-team quotas." — Cô lập = quyền + tài nguyên.`
});
window.MOCKS.push({
  id: 'X4',
  title: 'Design a multi-tenant issue tracker like Backlog/Jira',
  level: 2,
  prompt: `Design a SaaS issue tracker like Backlog or Jira: thousands of companies, each with projects, issues, custom workflows, comments, attachments, search, notifications and webhooks. Tenants must never see each other's data.
Thiết kế SaaS quản lý issue kiểu Backlog/Jira: hàng nghìn công ty, mỗi công ty có project, issue, workflow tùy biến, comment, file đính kèm, tìm kiếm, notification và webhook. Tenant không bao giờ được thấy dữ liệu của nhau.`,
  clarify: [
    `Hỏi: Quy mô? → Đáp: 20 000 tenant, 2 triệu người dùng, 500 triệu issue tổng, tenant lớn nhất 5 triệu issue và 20 000 người dùng.`,
    `Hỏi: Workflow tùy biến đến mức nào? → Đáp: Mỗi project định nghĩa trạng thái + chuyển trạng thái + điều kiện (quyền, field bắt buộc); không cần script tùy ý.`,
    `Hỏi: Tìm kiếm cần gì? → Đáp: Full-text trên title/description/comment + lọc field (assignee, status, custom field), kết quả < 1 s, cập nhật trong vài giây.`,
    `Hỏi: Notification/webhook? → Đáp: Email + in-app + webhook ra ngoài khi issue thay đổi; webhook phải retry, không chặn người dùng.`,
    `Hỏi: File đính kèm? → Đáp: Đến 100 MB/file, lưu object storage, link có hạn.`,
    `Hỏi: Tỉ lệ đọc/ghi? → Đáp: ~20:1; ghi ~200 issue/giây toàn hệ thống lúc đỉnh, đọc ~5 000 QPS.`,
    `Hỏi: Yêu cầu compliance? → Đáp: Audit log mọi thay đổi, có thể export/xóa toàn bộ dữ liệu một tenant, một số tenant yêu cầu region riêng (Nhật).`
  ],
  phases: {
    req: {
      checks: [
        `Functional: CRUD issue với custom field, workflow theo project, comment, attachment, search, notification 3 kênh, webhook retry, permission theo project/role, audit log.`,
        `Non-functional: cô lập tenant tuyệt đối (quyền + không noisy neighbor), đọc 5k QPS/ghi 200/s, search < 1 s cập nhật trong vài giây, 99,9%.`,
        `Tenant lớn 5 triệu issue là trường hợp thiết kế phải chịu được; phần lớn tenant nhỏ.`,
        `Audit, export/xóa theo tenant, region riêng là yêu cầu kiến trúc, không phải tính năng cuối.`,
        `Ngoài phạm vi: billing, agile board chi tiết, tích hợp Git.`
      ],
      hint: `Hỏi phân bố tenant (lớn nhất bao nhiêu) vì nó quyết định shared schema hay tách DB. Hỏi "workflow tùy biến" có cần script không — nếu không, một bảng chuyển trạng thái là đủ. Nói rõ "cô lập" gồm cả quyền lẫn tài nguyên.`
    },
    est: {
      checks: [
        `500 triệu issue × ~2 KB (field + index) ≈ 1 TB; comment ×5 × 1 KB ≈ 2,5 TB; audit log ×20 sự kiện × 500 B ≈ 5 TB/năm → DB chính vài TB, audit lớn nhất.`,
        `Ghi 200 issue/s + 1 000 comment/s + 4 000 audit/s → Postgres 1 primary đủ cho shared, cần partition audit.`,
        `Đọc 5 000 QPS: 80% là list/detail issue → cache + replica; 20% search → ES.`,
        `Attachment: 2 triệu người × 10 file × 2 MB ≈ 40 TB object storage; băng thông qua presigned URL, không qua API.`,
        `Webhook: mỗi thay đổi fan-out 1–5 webhook → ~5 000 HTTP ra ngoài/giây đỉnh, cần queue + retry + timeout.`
      ],
      hint: `Nhấn vào hai con số: audit log là bảng lớn nhất (hãy partition theo tháng và theo tenant lớn) và webhook ra ngoài là lưu lượng HTTP không kiểm soát được (đối tác chậm). Attachment đi thẳng S3 bằng presigned URL để API không gánh băng thông.`
    },
    hld: {
      checks: [
        `Sơ đồ: API (stateless) → Postgres shared schema có tenant_id + RLS; read replica; Redis cache; outbox → queue → worker (notification, webhook, indexer); Elasticsearch index per tenant hoặc routing theo tenant; S3 attachment; audit store.`,
        `Mọi bảng có tenant_id là cột đầu của PK/index; RLS bật với app.tenant_id; tenant rất lớn hoặc cần region riêng → DB riêng cùng schema (hybrid).`,
        `API: POST /projects/{p}/issues, PATCH /issues/{id} (transition), POST /issues/{id}/comments, GET /search?q&filters, POST /webhooks, GET /audit?since.`,
        `Mô hình dữ liệu: tenants, users, projects, issues(tenant_id, project_id, number, status_id, custom jsonb), issue_transitions, workflows/statuses/transitions, comments, attachments(s3_key), webhooks, deliveries, audit_events.`,
        `Mọi thay đổi issue → audit_events + outbox event trong cùng tx; worker fan-out ra notification/webhook/search.`
      ],
      hint: `Nguyên tắc: một ghi = một transaction gồm issue + audit + outbox. Mọi thứ ra ngoài (email, webhook, ES) là consumer của outbox. Vẽ RLS như một lớp trên DB. Nói rõ shared schema mặc định + "thoát hiểm" sang DB riêng cho tenant đặc biệt.`
    },
    deep: {
      checks: [
        `Cô lập tenant: tenant_id trong mọi bảng và index; RLS với SET LOCAL app.tenant_id mỗi tx; test tự động "query không có tenant_id thì fail"; ES index/alias per tenant hoặc routing + filter bắt buộc ở lớp API.`,
        `Workflow engine: bảng statuses, transitions(from, to, conditions jsonb, required_fields); transition là UPDATE có điều kiện WHERE status_id = $expected (optimistic) → tránh 2 người chuyển trạng thái chồng nhau.`,
        `Search: ES với index per tenant lớn, shared index có routing=tenant_id cho tenant nhỏ; indexer từ outbox, eventual vài giây; fallback Postgres FTS cho tenant rất nhỏ.`,
        `Webhook: queue riêng, timeout 10 s, retry backoff 1 phút → 24 giờ, ký HMAC, lưu deliveries(status, attempts, response_code), circuit breaker per endpoint để đối tác chết không ăn hết worker; idempotency key trong header cho người nhận.`,
        `Noisy neighbor: rate limit theo tenant ở API, queue partition theo tenant hoặc fair scheduling, giới hạn kích thước export; tenant 5 triệu issue có index riêng và statement_timeout riêng.`,
        `Audit log: append-only, partition theo tháng, không UPDATE/DELETE; export tenant = stream theo keyset; xóa tenant = soft-delete rồi job xóa theo partition.`
      ],
      hint: `Điểm xoáy chắc chắn: "Làm sao chắc chắn không leak cross-tenant?" → nhiều lớp (RLS + cột trong PK + test + ES filter). "Hai người cùng chuyển trạng thái" → optimistic WHERE. "Webhook đối tác chậm 30 s" → queue riêng + circuit breaker per endpoint. "Tenant lớn làm chậm tenant nhỏ" → fair queue + rate limit + tách index.`
    },
    wrap: {
      checks: [
        `Tóm tắt: shared schema + RLS + outbox là xương sống; thoát hiểm DB riêng cho tenant đặc biệt.`,
        `Trade-off: search eventual vài giây; webhook at-least-once; shared schema rủi ro leak được bù bằng nhiều lớp kiểm soát.`,
        `Việc làm thêm: region Nhật riêng (cell), SLA theo tier, billing theo usage.`,
        `Metric vận hành: outbox lag, webhook failure theo endpoint, ES indexing lag, query theo tenant.`
      ],
      hint: `Kết: "Mỗi ghi là một transaction có audit + outbox; mọi thứ khác là consumer; tenant_id đi theo mọi dòng dữ liệu từ DB đến ES đến S3 key."`
    }
  },
  followups: [
    `How do you guarantee a tenant can never read another tenant's issues, even if a developer forgets a WHERE clause?`,
    `Two users move the same issue to different statuses at the same time. What happens?`,
    `A customer's webhook endpoint is down for 2 days. What happens to their events and to other customers?`,
    `Your largest tenant has 5 million issues and search became slow for everyone. What do you change?`,
    `A Japanese customer requires their data to stay in Japan. How does your design accommodate that?`,
    `How do you implement "export everything for tenant X" without hurting production?`,
    `Why an outbox instead of publishing to the queue directly from the API?`,
    `How would you shard if a single Postgres primary is no longer enough?`
  ],
  rubric_notes: `### Câu trả lời mạnh có gì
- Cô lập tenant nhiều lớp: tenant_id trong PK/index, RLS, test tự động, ES filter ở API, S3 key có tenant prefix — và nói rõ RLS không thay thế được kỷ luật code.
- Outbox là trung tâm: issue + audit + outbox trong 1 tx; notification/webhook/indexer là consumer (bài học publish trước commit).
- Webhook được coi là hệ thống riêng: queue, retry dài, HMAC, circuit breaker per endpoint, bảng deliveries để khách tự xem.
- Phân biệt tenant nhỏ và tenant lớn trong cùng thiết kế (hybrid shared/dedicated).
### Bẫy thường gặp
- Schema per tenant cho 20 000 tenant → 20 000 lần migration, connection pool vỡ.
- Workflow engine kiểu script tùy ý khi yêu cầu chỉ là bảng chuyển trạng thái.
- Gọi webhook/email đồng bộ trong request → API chậm theo đối tác.
- Quên audit log là bảng lớn nhất và cần partition từ đầu.
### Dấu hiệu senior
- Nhắc đến "first-writer-wins trên dữ liệu chung" là nguồn leak kinh điển và cách tách dữ liệu per-tenant.
- Đưa ra chiến lược cell/region như kiến trúc, không như "sau này tính".`,
  reference: `### Yêu cầu chốt
- Functional: issue + custom field, workflow theo project (trạng thái, chuyển trạng thái, điều kiện), comment, attachment ≤ 100 MB, search full-text + filter, notification email/in-app/webhook, permission theo project/role, audit log, export/xóa tenant.
- Non-functional: cô lập tenant (quyền + tài nguyên), đọc 5k QPS, ghi 200 issue/s, search < 1 s cập nhật vài giây, 99,9%, tenant lớn nhất 5 triệu issue, một số tenant cần region Nhật.
### Ước lượng
| Đại lượng | Tính | Kết quả |
|---|---|---|
| Issue | 500M × 2 KB | ~1 TB |
| Comment | 2,5 tỉ × 1 KB | ~2,5 TB |
| Audit | 10 tỉ sự kiện/năm × 500 B | ~5 TB/năm → partition theo tháng |
| Ghi | 200 issue + 1k comment + 4k audit mỗi giây | 1 primary Postgres đủ, audit là tải chính |
| Đọc | 5k QPS, 80% list/detail | replica + cache; 20% search → ES |
| Attachment | 2M user × 10 × 2 MB | ~40 TB S3, presigned URL |
| Webhook | 1–5 mỗi thay đổi | ~5k HTTP ra/giây đỉnh |
### Thiết kế tổng thể
:::diagram
Web[Web/Mobile/API client] -> API[API stateless + tenant resolver]
API -> PG[Postgres shared schema + RLS]
PG -> RR[Read replica]
API -> RR : list/detail
API -> Cache[Redis]
API -> S3[Object storage attachment] : presigned URL
PG -> Relay[Outbox relay]
Relay -> MQ[Queue]
MQ -> Notif[Notification worker]
MQ -> Hook[Webhook worker + circuit breaker]
MQ -> Idx[Search indexer]
Idx -> ES[Elasticsearch per-tenant routing]
API -> ES : search
Hook -> Ext[Customer endpoints]
:::
- Luồng ghi (chuyển trạng thái): API resolve tenant từ JWT/subdomain → BEGIN; SET LOCAL app.tenant_id; UPDATE issues SET status_id = $new WHERE id = $id AND status_id = $expected (0 row → 409); INSERT audit_events; INSERT outbox; COMMIT → relay publish → worker gửi notification, webhook, cập nhật ES.
- Luồng đọc: list issue theo project từ replica với keyset pagination; detail có cache 30 s; search qua ES với filter tenant_id bắt buộc do API gắn, không do client.
- Dữ liệu: issues(tenant_id, id ULID, project_id, number, status_id, assignee_id, custom jsonb, updated_at) PK (tenant_id, id), UNIQUE (tenant_id, project_id, number); statuses, transitions(tenant_id, workflow_id, from_status, to_status, conditions jsonb, required_fields text[]); comments; attachments(tenant_id, issue_id, s3_key = tenant/issue/uuid); webhooks(tenant_id, url, secret, events); deliveries(webhook_id, event_id, attempts, status, last_code); audit_events partition theo tháng.
### Đào sâu
**1. Cô lập tenant.** Lớp 1: tenant_id là cột đầu mọi PK/index và mọi query đi qua repository có tenant scope. Lớp 2: RLS trên mọi bảng với policy tenant_id = current_setting(app.tenant_id); app SET LOCAL mỗi tx (pool dùng chung nên không SET session). Lớp 3: test tích hợp chạy mọi endpoint với 2 tenant và assert không thấy dữ liệu nhau; CI fail nếu query mới không có tenant_id. Lớp 4: ES filter tenant_id gắn ở server, S3 key có prefix tenant và presigned URL ngắn hạn. Dữ liệu dùng chung (ví dụ danh mục license, CVE) không được để tenant ghi đè — overlay per tenant.
**2. Workflow và concurrency.** Transition là bảng cấu hình; điều kiện đơn giản đánh giá trong code (role, field bắt buộc). Hai người chuyển cùng lúc: UPDATE có điều kiện status_id = $expected là optimistic lock; người thua nhận 409 và UI reload. Không cần SELECT FOR UPDATE.
**3. Webhook.** Queue riêng (không chung với notification), worker gửi với timeout 10 s, ký HMAC-SHA256 body, header X-Event-Id để người nhận idempotent; retry backoff 1 phút → 24 giờ (tối đa ~10 lần); circuit breaker per endpoint: endpoint lỗi liên tiếp 20 lần → tạm dừng 15 phút và chỉ thử 1 request thăm dò; deliveries lưu lịch sử để khách tự debug. Đối tác chết 2 ngày: event của họ nằm trong deliveries chờ retry, worker khác không bị chiếm vì breaker.
**4. Tenant lớn và noisy neighbor.** Rate limit theo tenant ở API; queue consumer kéo theo round-robin tenant; ES: tenant > 1 triệu issue có index riêng, còn lại shared index routing theo tenant_id; statement_timeout theo tier; export = job async stream keyset ra file S3. Tenant cần region Nhật → cell riêng (API + DB + ES cùng schema, routing ở DNS/gateway theo tenant); không cross-region replication dữ liệu tenant.
### Trade-off
| Lựa chọn | Được | Mất |
|---|---|---|
| Shared schema + RLS | Một migration, chi phí thấp, pool đơn giản | Rủi ro leak phải bù bằng nhiều lớp; noisy neighbor |
| Outbox cho mọi side effect | Không mất event, API nhanh | Eventual cho search/notification, thêm relay |
| Webhook at-least-once | Không mất event cho khách | Khách phải idempotent; bảng deliveries lớn |
| Cell theo region | Compliance, blast radius nhỏ | Vận hành nhiều bản sao hạ tầng |
### Nói thế nào trong phỏng vấn (EN)
- "Tenant isolation is defense in depth: tenant_id in every key, row-level security in Postgres, and tests that fail if a query forgets the tenant." — Cô lập tenant là nhiều lớp.
- "Every write is one transaction: the issue change, the audit event and the outbox row — everything external is a consumer of that outbox." — Một ghi = một transaction có audit + outbox.
- "Webhooks are someone else's uptime, so they get their own queue, retries and a circuit breaker per endpoint." — Webhook là uptime của người khác, cần cô lập.`
});
window.MOCKS.push({
  id: 'X5',
  title: 'Design a CI license-compliance scanner SaaS',
  level: 2,
  prompt: `Design a SaaS that scans a repository's dependencies for license compliance on every pull request: it receives GitHub webhooks, resolves the dependency tree, looks up licenses from external sources, evaluates the customer's policy, and posts a pass/fail comment on the PR within a few minutes.
Thiết kế SaaS quét license dependency trên mỗi pull request: nhận webhook GitHub, phân giải cây dependency, tra license từ nguồn ngoài, đánh giá policy của khách, và comment pass/fail lên PR trong vài phút.`,
  clarify: [
    `Hỏi: Quy mô? → Đáp: 5 000 tổ chức, 50 000 repo, ~200 000 PR event/ngày, đỉnh 20 event/giây giờ làm việc.`,
    `Hỏi: Kích thước dependency tree? → Đáp: Trung bình 300 package, lớn nhất 20 000 (monorepo JS).`,
    `Hỏi: Nguồn license ngoài? → Đáp: Một API kiểu ClearlyDefined/deps.dev: batch tối đa 100 coordinate/request, rate limit ~10 request/giây cho cả SaaS, đôi khi trả lỗi từng item hoặc 5xx cả batch.`,
    `Hỏi: SLA? → Đáp: Comment trong 5 phút cho 95% PR; không bao giờ comment sai (false pass); nếu không chắc thì báo "pending".`,
    `Hỏi: Policy là gì? → Đáp: Danh sách license cho phép/cấm theo tổ chức, ngoại lệ theo package; phải giải thích lý do fail.`,
    `Hỏi: Có cần lịch sử và dashboard? → Đáp: Có — xem kết quả theo repo/PR, xu hướng theo thời gian; audit ai đổi policy.`,
    `Hỏi: Có được cache kết quả tra cứu giữa các khách không? → Đáp: Được với dữ liệu khách quan (license của package@version); không với policy/ngoại lệ của khách.`
  ],
  phases: {
    req: {
      checks: [
        `Functional: nhận webhook (ký, dedup), lấy manifest/lockfile, phân giải dependency, tra license (có cache), đánh giá policy, comment PR + check status, dashboard/lịch sử, audit policy.`,
        `Non-functional: 95% PR có kết quả < 5 phút, không false pass (fail-closed → pending), chịu rate limit 10 req/s của nguồn ngoài, idempotent với webhook redelivery.`,
        `Phân biệt dữ liệu khách quan (license của package@version — cache chung) và dữ liệu khách (policy, ngoại lệ — per tenant).`,
        `Lỗi nguồn ngoài là trạng thái bình thường của hệ thống, phải thiết kế vào status machine.`,
        `Ngoài phạm vi: SCA vulnerability, SBOM export, IDE plugin.`
      ],
      hint: `Hỏi ngay rate limit và kích thước batch của nguồn ngoài — đó là nút cổ chai thật. Hỏi "không chắc thì pass hay fail" để chốt fail-closed/pending. Hỏi có được cache chung không — câu trả lời quyết định 90% chi phí.`
    },
    est: {
      checks: [
        `200k PR/ngày × 300 package ≈ 60 triệu lookup/ngày; với cache hit 95% (package@version lặp lại khắp nơi) → 3 triệu lookup ngoài/ngày ≈ 35/s trung bình → 30 000 batch 100/ngày.`,
        `Rate limit 10 req/s × 100 coordinate = 1 000 coordinate/s tối đa → 86 triệu/ngày: đủ cho miss nhưng không đủ nếu cache hit < 50%.`,
        `Đỉnh 20 PR/s × 300 = 6 000 coordinate/s → vượt 1 000/s của nguồn ngoài → phải queue và ưu tiên; cache là thứ cứu SLA.`,
        `Lưu trữ: bảng license cache 50 triệu package@version × 300 B ≈ 15 GB; kết quả scan 200k/ngày × 50 KB ≈ 10 GB/ngày → 3,6 TB/năm, nén hoặc S3 cho chi tiết.`,
        `Worker: phân giải dependency 10–60 s CPU mỗi PR → 200k × 30 s / 86 400 ≈ 70 worker-core trung bình, 3× lúc đỉnh.`
      ],
      hint: `Con số phải nói: 60 triệu lookup/ngày và 1 000 coordinate/s trần → cache hit ratio là KPI số 1. Tính "đỉnh vượt trần bao nhiêu lần" để biện minh queue + ưu tiên PR mới hơn backfill. Nói rõ content hash của lockfile cho phép bỏ qua phân giải khi lockfile không đổi.`
    },
    hld: {
      checks: [
        `Sơ đồ: GitHub → webhook receiver (verify HMAC, dedup delivery_id, trả 200 ngay) → queue scan → resolver worker (clone/lấy lockfile, dependency tree, content hash) → license lookup service (cache Postgres/Redis → batch gọi nguồn ngoài qua rate limiter toàn cục) → policy engine → PR commenter/check run → DB kết quả + dashboard.`,
        `Status machine của scan: received → resolving → enriching (pending items) → evaluated → commented; failed_transient/failed_permanent có lý do.`,
        `API: POST /webhooks/github, GET /orgs/{o}/policy, PUT /orgs/{o}/policy, GET /repos/{r}/scans, GET /scans/{id}, POST /scans/{id}/rerun.`,
        `Mô hình dữ liệu: installations, repos, scans(repo, pr, sha, lockfile_hash, status), scan_components(scan_id, purl, license_resolved, status), license_cache(purl PK, license, source, fetched_at, status), policies(org, rules jsonb, version), policy_audit.`,
        `Cache theo lockfile_hash: cùng hash → tái dùng kết quả resolve; cache license theo purl dùng chung mọi tenant.`
      ],
      hint: `Webhook receiver phải "nhận và trả 200 trong < 1 s" — xử lý sau. Vẽ rate limiter toàn cục trước nguồn ngoài như một thành phần, không phải chi tiết. Hai tầng cache (lockfile hash, purl) là xương sống SLA. Status machine nên có trong phần HLD vì nó quyết định UX "pending".`
    },
    deep: {
      checks: [
        `Gọi nguồn ngoài theo batch 100 nhưng isolate per item: item lỗi → đánh dấu riêng (pending_retry hoặc unknown), không fail cả scan; batch 5xx → retry backoff; version-range/coordinate không hợp lệ → failed_permanent ngay, không retry.`,
        `Rate limiter toàn cục (Redis token bucket 10/s) + hàng đợi ưu tiên: PR mới > rerun > backfill; đọc Retry-After; circuit breaker khi nguồn ngoài chết → scan vào pending, comment "pending" lên PR, sweeper hoàn tất sau.`,
        `Idempotency: webhook delivery_id unique; scan key (repo, sha) unique; comment PR upsert (sửa comment cũ thay vì thêm) và check run theo external_id.`,
        `Fail-closed: thiếu license cho package nằm trong rule cấm/không rõ → trạng thái "needs review", không pass; giải thích rõ package nào, vì sao.`,
        `Sweeper cho item pending: partial index trên status pending, fairness theo org, retry với attempts/backoff, không lấy "100 cũ nhất" mãi; alert khi last_success của enrichment > 5 phút hoặc pending không giảm.`,
        `Cache chung an toàn: chỉ cache dữ liệu khách quan có nguồn; license do khách override lưu per org (overlay), merge lúc đánh giá; TTL/refresh khi nguồn cập nhật.`
      ],
      hint: `Đây gần như là hệ thống bạn đang làm: hãy kể bằng bài học thật — batch bị một item làm hỏng, sweeper starvation, Lambda mất env, publisher không reconnect, first-writer-wins cross-tenant. Mỗi điểm nêu vấn đề → 2 phương án → chọn. Phỏng vấn viên sẽ xoáy "nguồn ngoài chết 1 giờ thì PR của khách ra sao" — trả lời bằng pending có hạn + sweeper + alert.`
    },
    wrap: {
      checks: [
        `Tóm tắt: hai tầng cache cứu SLA; batch + isolate per item + status machine cứu độ đúng; rate limiter + ưu tiên cứu nguồn ngoài.`,
        `Trade-off: fail-closed làm nhiều PR "pending/needs review" hơn → UX kém hơn nhưng không false pass; cache chung tiết kiệm 95% nhưng cần nguồn gốc rõ.`,
        `Metric: cache hit ratio, external 429/5xx, pending age p95, scan duration p95, comment latency p95.`,
        `Việc làm thêm: phân giải dependency không cần clone (lockfile only), self-hosted runner cho khách lớn, SBOM export.`
      ],
      hint: `Kết bằng ba KPI: cache hit, pending age, comment latency. Nêu rõ fail-closed là quyết định sản phẩm đã chốt với khách.`
    }
  },
  followups: [
    `The external license API returns 500 for a whole batch of 100. What happens to that PR, and to the other 99 packages?`,
    `One coordinate in a batch is malformed and the API rejects the entire batch. How do you prevent one bad item from poisoning the rest?`,
    `GitHub redelivers the same webhook three times. How many scans run and how many comments appear?`,
    `The external source is rate-limited to 10 requests per second and you receive 20 PRs per second at peak. How do you still meet the 5-minute SLA?`,
    `Can you cache license lookups across customers? What must never be shared?`,
    `Your sweeper always picks the 100 oldest pending items and they always fail. What is wrong and how do you fix it?`,
    `How do you know the pipeline is healthy when there are no errors in the logs?`,
    `A customer says a package is MIT but your source says GPL. Whose answer wins, and for whom?`
  ],
  rubric_notes: `### Câu trả lời mạnh có gì
- Nhận ra nút cổ chai thật là nguồn ngoài (10 req/s, batch 100) và đưa cache hai tầng (lockfile hash, purl) làm xương sống SLA với con số hit ratio.
- Status machine rõ ràng, có trạng thái pending/needs review có hạn và sweeper hoàn tất — không có "kẹt vĩnh viễn".
- Isolate per item trong batch, phân loại lỗi vĩnh viễn/tạm thời, không nuốt lỗi.
- Idempotency ở ba chỗ: webhook delivery, scan (repo, sha), comment/check run upsert.
- Alert theo "kết quả" (last_success, pending age) chứ không theo log lỗi.
- Tách dữ liệu khách quan (cache chung) khỏi dữ liệu khách (overlay per org).
### Bẫy thường gặp
- Xử lý đồng bộ trong webhook handler → GitHub timeout 10 s, redelivery, scan trùng.
- Một batch fail = cả scan fail, hoặc retry vô hạn item hỏng vĩnh viễn.
- "Sweeper lấy cũ nhất" → starvation; query pending không có partial index → chạy hàng phút.
- Fail-open: thiếu license thì pass → khách merge GPL vào sản phẩm thương mại.
### Dấu hiệu senior
- Kể được một sự cố thật tương ứng và điều đã học (publisher không reconnect, env mất sau deploy, FetchBatch nuốt lỗi).
- Chủ động nêu KPI vận hành và alert trước khi bị hỏi.`,
  reference: `### Yêu cầu chốt
- Functional: webhook GitHub (verify, dedup), lấy lockfile, phân giải dependency tree, tra license có cache, policy per org (allow/deny/ngoại lệ) có giải thích, comment + check run trên PR, dashboard/lịch sử, audit policy.
- Non-functional: 95% PR có kết quả < 5 phút; không false pass (fail-closed → needs review); nguồn ngoài 10 req/s × 100 coordinate, lỗi từng item hoặc cả batch; idempotent với redelivery; 50k repo, 200k PR/ngày, đỉnh 20/s.
### Ước lượng
| Đại lượng | Tính | Kết quả |
|---|---|---|
| Lookup thô | 200k PR × 300 package | 60 triệu/ngày |
| Lookup ra ngoài | hit cache 95% | 3 triệu/ngày ≈ 35/s ≈ 30k batch |
| Trần nguồn ngoài | 10 req/s × 100 | 1 000 coordinate/s |
| Đỉnh | 20 PR/s × 300 | 6 000 coordinate/s → 6× trần nếu cache miss |
| License cache | 50M purl × 300 B | ~15 GB Postgres |
| Kết quả scan | 200k × 50 KB | 10 GB/ngày, chi tiết ra S3 sau 30 ngày |
| Worker resolve | 200k × 30 s CPU / 86 400 | ~70 core trung bình, 200 đỉnh |
### Thiết kế tổng thể
:::diagram
GH[GitHub] -> WH[Webhook receiver verify HMAC + dedup] : PR event
WH -> DB[Postgres scans/components/policies]
WH -> Q[Queue scan] : qua outbox
Q -> RS[Resolver worker lockfile → tree]
RS -> DB : scan_components pending
RS -> LK[License lookup service]
LK -> Cache[license_cache purl → license]
LK -> RL[Rate limiter toàn cục 10 req/s]
RL -> EXT[External license API batch 100]
LK -> DB : cập nhật item
DB -> PE[Policy engine]
PE -> GHC[PR commenter / check run upsert]
SW[Sweeper fair theo org] -> DB
SW -> LK : retry pending
:::
- Luồng chính: webhook → verify chữ ký, INSERT deliveries(delivery_id UNIQUE) → upsert scans(repo, sha) → outbox → 200 OK trong < 1 s. Resolver lấy lockfile qua GitHub API, tính lockfile_hash; nếu đã có scan hoàn tất với cùng hash → copy kết quả, bỏ qua resolve. Ngược lại dựng tree → purl list → lookup: hit cache thì xong; miss thì gom batch 100, qua rate limiter, gọi nguồn ngoài, ghi cache và item. Khi mọi item done hoặc failed_permanent → policy engine → comment/check run (upsert theo scan). Item còn pending quá 2 phút → comment "pending, sẽ cập nhật" → sweeper hoàn tất và upsert lại comment.
- API: POST /webhooks/github; GET/PUT /orgs/{o}/policy (versioned, audit); GET /repos/{r}/scans; GET /scans/{id}; POST /scans/{id}/rerun.
- Dữ liệu: scans(id, org_id, repo_id, pr, sha, lockfile_hash, status, created_at) UNIQUE (repo_id, sha); scan_components(scan_id, purl, status, license, attempts, retry_at, last_error) partial index (retry_at) WHERE status IN (pending, failed_transient); license_cache(purl PK, license, source, fetched_at, status); org_license_overrides(org_id, purl, license, reason); policies(org_id, version, rules jsonb); policy_audit.
### Đào sâu
**1. Batch với nguồn ngoài không tin cậy.** Gọi batch 100 nhưng xử lý kết quả per item: item có license → done + cache; item lỗi tạm → failed_transient (attempts++, retry_at backoff mũ có jitter, tối đa 8 lần); item lỗi vĩnh viễn (coordinate không hợp lệ, version-range, 404) → failed_permanent ngay, không bao giờ retry, có last_error. Cả batch 5xx/429 → mọi item transient, đọc Retry-After. Nếu nguồn từ chối cả batch vì 1 item hỏng (lỗi thật đã gặp): bisect batch hoặc validate coordinate trước khi gửi. Không có đường nào nuốt lỗi im lặng: mỗi nhánh tăng một counter có label result.
**2. Rate limit và ưu tiên.** Token bucket toàn cục trong Redis (10/s) để mọi worker chia sẻ một quota; hàng đợi lookup có 3 mức ưu tiên: PR mới > rerun > backfill/refresh cache. Khi nguồn ngoài chết (circuit breaker mở): scan vẫn hoàn tất với item pending, PR nhận comment "pending" + check run neutral; sweeper chạy lại khi breaker đóng. SLA 5 phút được giữ nhờ cache 95% — đỉnh 6× trần chỉ ảnh hưởng 5% miss.
**3. Sweeper không starvation.** Query claim: UPDATE ... WHERE id IN (SELECT id FROM scan_components WHERE org_id = $1 AND status IN (pending, failed_transient) AND retry_at <= now() ORDER BY retry_at LIMIT 200 FOR UPDATE SKIP LOCKED) RETURNING id — round-robin theo org, partial index để ms thay vì phút, budget thời gian mỗi vòng, metric rows_processed và pending_age_p95. Item failed_permanent không nằm trong tập pending nên không chiếm chỗ.
**4. Cache chung và dữ liệu khách.** license_cache là dữ liệu khách quan có nguồn (source, fetched_at) dùng chung mọi org; khách override lưu org_license_overrides và chỉ áp cho org đó khi đánh giá (overlay) — không bao giờ ghi vào cache chung (bài học first-writer-wins leak cross-tenant). Policy đánh giá: deny > allow > unknown; unknown/pending với package trong deny list → needs review (fail-closed).
### Trade-off
| Lựa chọn | Được | Mất |
|---|---|---|
| Fail-closed (needs review) | Không false pass | Nhiều PR "vàng", khách phàn nàn khi nguồn ngoài chập chờn |
| Cache chung theo purl | Giảm 95% lời gọi ngoài, SLA | Phải quản lý nguồn gốc/TTL, không chứa dữ liệu khách |
| Batch 100 + isolate per item | Ít request, chịu lỗi từng item | Code phức tạp hơn, phải phân loại lỗi đúng |
| Sweeper fair theo org | Org nhỏ không bị org lớn chặn | Org lớn chậm hơn FIFO |
### Nói thế nào trong phỏng vấn (EN)
- "The real bottleneck is the external source — ten requests a second — so cache hit ratio is my number one KPI." — Nút cổ chai thật là nguồn ngoài, cache hit là KPI số 1.
- "I call the source in batches but I never let one bad coordinate fail the whole batch; each item has its own state and its own retry schedule." — Batch nhưng isolate per item.
- "When we are not sure, we never pass; the PR gets a pending status and a sweeper finishes the job — and an alert fires if nothing succeeds for five minutes." — Fail-closed + sweeper + alert theo kết quả.`
});
window.MOCKS.push({
  id: 'X6',
  title: 'Design a ride-hailing dispatch (nearby drivers + matching)',
  level: 3,
  prompt: `Design the dispatch core of a ride-hailing app like Grab or Uber: track driver locations in real time, find nearby available drivers when a rider requests a trip, match one driver, compute ETA and surge pricing, and keep both apps updated live.
Thiết kế lõi điều phối của app gọi xe kiểu Grab/Uber: theo dõi vị trí tài xế thời gian thực, tìm tài xế rảnh gần nhất khi có yêu cầu, ghép một tài xế, tính ETA và giá surge, cập nhật live cho cả hai app.`,
  clarify: [
    `Hỏi: Quy mô? → Đáp: 1 thành phố lớn trước: 200 000 tài xế online lúc đỉnh, 50 000 yêu cầu chuyến/phút đỉnh (~800/s); mở rộng 50 thành phố.`,
    `Hỏi: Tần suất cập nhật vị trí? → Đáp: Tài xế gửi mỗi 3–5 s khi online; rider chỉ gửi khi đặt xe và trong chuyến.`,
    `Hỏi: Độ trễ ghép? → Đáp: Rider thấy "đang tìm" ≤ 1–2 s để có ứng viên; tài xế có 10–15 s để nhận; tổng ghép < 30 s.`,
    `Hỏi: Tiêu chí ghép? → Đáp: ETA đến điểm đón (không phải khoảng cách thẳng), rating, tỉ lệ nhận; ưu tiên công bằng vừa phải; không gửi một yêu cầu cho nhiều tài xế cùng lúc ở phiên bản đầu (tuần tự từng người).`,
    `Hỏi: Surge? → Đáp: Theo ô địa lý và cửa sổ thời gian 2–5 phút dựa trên cung/cầu; cập nhật mỗi phút; phải nhất quán giữa báo giá và tính tiền.`,
    `Hỏi: Consistency? → Đáp: Một tài xế không được ghép hai chuyến cùng lúc (bất biến). Vị trí có thể cũ vài giây.`,
    `Hỏi: Ngoài phạm vi? → Đáp: Thanh toán, bản đồ/routing engine (coi là dịch vụ ngoài trả ETA), chat.`
  ],
  phases: {
    req: {
      checks: [
        `Functional: ingest vị trí tài xế, tìm ứng viên gần theo ETA, ghép tuần tự với timeout nhận, trạng thái chuyến, surge theo ô, cập nhật live hai app.`,
        `Bất biến: một tài xế một chuyến tại một thời điểm; báo giá surge lúc đặt phải khớp lúc tính tiền.`,
        `Non-functional: 200k tài xế × 1 cập nhật/4 s = 50k vị trí/s; 800 yêu cầu/s; ứng viên < 2 s; vị trí cũ vài giây chấp nhận được.`,
        `Phân biệt dữ liệu nóng (vị trí hiện tại, trạng thái tài xế — RAM) và dữ liệu bền (chuyến, giá, lịch sử — DB).`,
        `Ngoài phạm vi: payment, routing engine, chat.`
      ],
      hint: `Hỏi tần suất ping vị trí trước — nó quyết định throughput ghi. Hỏi "ghép gửi một hay nhiều tài xế cùng lúc" vì nó quyết định độ phức tạp của lock. Nêu bất biến "một tài xế một chuyến" ngay và nói nó là thứ bạn sẽ bảo vệ trong phần deep.`
    },
    est: {
      checks: [
        `Vị trí: 200k / 4 s = 50k ghi/s, mỗi bản ghi ~50 B → 2,5 MB/s; chỉ giữ vị trí mới nhất trong RAM (200k × 100 B = 20 MB) + lịch sử ra Kafka/S3 nếu cần.`,
        `Yêu cầu: 800/s; mỗi yêu cầu tìm ~20 ứng viên trong bán kính 2–3 km rồi gọi ETA cho top 10 → 8 000 ETA/s → ETA service/cache là tải lớn.`,
        `Geohash cấp 6 (~1,2 km × 0,6 km) → thành phố 1 000 km² ≈ 1 500 ô; 200k tài xế → ~130/ô trung bình, trung tâm có thể 2 000/ô.`,
        `WebSocket/push: 200k tài xế + ~100k rider đang đặt/đi → 300k kết nối; gateway 20k/kết nối/node → 15 node.`,
        `Chuyến: 50k/phút đỉnh → ~3 triệu chuyến/ngày × 2 KB → 6 GB/ngày DB chuyến, partition theo tháng.`
      ],
      hint: `Hai con số phải nói: 50k vị trí/s (ghi, RAM) và 8 000 ETA/s (gọi ngoài, cache theo cặp ô). Chỉ ra vị trí chỉ cần "mới nhất", không cần lịch sử trong đường nóng — nên là Redis/in-memory, không phải Postgres.`
    },
    hld: {
      checks: [
        `Sơ đồ: driver app → location gateway (WebSocket/UDP-ish) → location service (Redis GEO/sorted set theo geohash cell, TTL) ; rider app → trip service → matching service (tìm ứng viên → ETA → chọn → offer tuần tự) → driver push ; surge service đọc cung/cầu theo ô mỗi phút → pricing ; trips DB (Postgres) ; event bus cho analytics/notification.`,
        `Vị trí: key theo cell geohash, giá trị tài xế + tọa độ + ts, TTL 30 s để tài xế offline tự biến mất; truy vấn cell + 8 ô lân cận rồi lọc khoảng cách.`,
        `API: WS driver/location, POST /trips (quote_id), GET /trips/{id} (stream), POST /offers/{id}/accept|decline, GET /quote?from&to (giá + surge + ETA), driver status online/offline/busy.`,
        `Mô hình dữ liệu: trips(id, rider, driver, status, quote_id, surge, cell, created_at), offers(trip_id, driver_id, sent_at, expires_at, response), driver_state (Redis: status, current_trip), surge_cells(cell, window, multiplier).`,
        `Trạng thái chuyến: requested → matching → offered → accepted → arriving → in_progress → completed/cancelled; mỗi chuyển có idempotency.`
      ],
      hint: `Vẽ rõ hai đường: đường nóng (vị trí → Redis → matching → push) không chạm Postgres; đường bền (trip, offer, giá) qua Postgres. Nói geohash cell + 8 lân cận bằng một câu, và TTL là cách xử lý tài xế offline không cần "logout". Matching là một service có trạng thái per thành phố/vùng — nói ngay cách scale theo vùng.`
    },
    deep: {
      checks: [
        `Tìm lân cận: geohash cell cấp 6 + 8 ô lân cận (xử lý biên); cell quá đông (> 500) → chia cấp 7 hoặc giới hạn ứng viên theo thời gian cập nhật gần nhất; so sánh nhanh với quadtree/H3.`,
        `Bất biến một tài xế một chuyến: lock tài xế khi gửi offer (Redis SET NX driver:lock:{id} với TTL = thời gian offer + 5 s, hoặc Lua CAS trên driver_state status=available→offered); accept là CAS lần nữa; DB trips có UNIQUE partial (driver_id) WHERE status IN (accepted, arriving, in_progress) làm lưới cuối.`,
        `Offer tuần tự với timeout: offer hết hạn 15 s → giải phóng lock → tài xế tiếp theo; rider hủy → hủy offer đang mở; tất cả qua state machine có version để chống event đến muộn (accept sau khi đã timeout).`,
        `ETA: gọi routing engine cho top 10 ứng viên, cache ETA theo cặp (cell tài xế, cell đón) 60 s, fallback haversine × hệ số khi routing chậm; timeout 300 ms.`,
        `Surge: đếm yêu cầu và tài xế rảnh theo cell mỗi phút (stream/Redis counter) → multiplier có làm mượt (không nhảy 1,0 → 3,0) → lưu quote(id, surge, expires 2 phút) → trip tham chiếu quote_id để giá lúc tính tiền = giá đã báo.`,
        `Scale theo vùng: matching service shard theo thành phố/cell lớn (consistent hashing hoặc routing tĩnh); failover bằng cách rebuild trạng thái từ Redis + DB; gateway WebSocket không giữ logic.`
      ],
      hint: `Điểm xoáy chắc chắn: "Hai chuyến cùng offer cho một tài xế" → CAS Redis + unique partial trong DB. "Tài xế accept đúng lúc offer timeout" → version/state machine, ai thắng ghi trước. "Ô trung tâm 2 000 tài xế" → chia nhỏ cell/giới hạn ứng viên. "Routing engine chậm" → cache theo cặp cell + fallback. "Surge báo 1,5 nhưng tính 2,0" → quote_id bất biến.`
    },
    wrap: {
      checks: [
        `Tóm tắt: vị trí trong RAM theo cell với TTL; matching có lock tài xế + state machine; DB là lưới cuối và nguồn bền; quote bất biến cho surge.`,
        `Trade-off: offer tuần tự (công bằng, đơn giản) chậm hơn broadcast; vị trí cũ vài giây chấp nhận; ETA xấp xỉ khi routing chậm.`,
        `Metric: thời gian đến ứng viên đầu tiên, tỉ lệ nhận, time-to-match p95, vị trí stale ratio, ETA sai số.`,
        `Việc làm thêm: batch matching (ghép nhiều yêu cầu cùng lúc tối ưu toàn cục), dự đoán cầu, multi-city cell.`
      ],
      hint: `Kết: "RAM cho cái gì đổi mỗi 4 giây, Postgres cho cái gì phải nhớ, một lock cho bất biến duy nhất, một quote_id cho giá." Bốn vế.`
    }
  },
  followups: [
    `Two riders request at the same moment and the best driver is the same person. How do you guarantee only one gets him?`,
    `A driver accepts exactly as the offer times out. What is the final state and how is it decided?`,
    `Why geohash instead of a quadtree or H3, and what do you do at cell boundaries?`,
    `The city center has 2,000 drivers in one cell. How does your nearby query stay fast?`,
    `The routing/ETA service is slow or down. How do you still match within 30 seconds?`,
    `Surge was 1.5x when the rider booked and 2.0x when the trip ended. What do you charge and why?`,
    `How do you detect that a driver app silently stopped sending locations?`,
    `How would you shard the matching service across 50 cities, and what happens when one shard dies?`,
    `Would you broadcast an offer to several drivers at once? What changes?`
  ],
  rubric_notes: `### Câu trả lời mạnh có gì
- Tách đường nóng (vị trí → RAM theo cell với TTL → matching → push) khỏi đường bền (trip, offer, quote trong Postgres) và nói rõ vì sao.
- Bảo vệ bất biến "một tài xế một chuyến" ở hai lớp: CAS/lock trong Redis cho tốc độ, unique partial index trong DB làm lưới cuối.
- State machine có version cho offer/trip để xử lý event đến muộn (accept sau timeout).
- Geohash + 8 ô lân cận, biết điểm yếu ở biên và ô quá đông; so sánh ngắn với H3.
- Quote bất biến cho surge; ETA có cache + fallback + timeout.
### Bẫy thường gặp
- Ghi 50k vị trí/s vào Postgres rồi query ST_DWithin cho mỗi yêu cầu → DB chết.
- Không lock tài xế khi offer → double booking, phát hiện khi khách phàn nàn.
- Chỉ dùng cell hiện tại (không lân cận) → tài xế cách 200 m ở ô bên cạnh bị bỏ qua.
- Gọi routing engine đồng bộ cho 50 ứng viên mỗi yêu cầu → 40k ETA/s.
### Dấu hiệu senior
- Nhắc TTL là cơ chế "offline detection" miễn phí và liên hệ với heartbeat/alert "im lặng".
- Đưa ra batch matching như bước tiếp theo, biết vì sao chưa làm ở phiên bản đầu.`,
  reference: `### Yêu cầu chốt
- Functional: ingest vị trí tài xế 3–5 s/lần; tìm ứng viên rảnh gần theo ETA; offer tuần tự có timeout 15 s; state machine chuyến; surge theo ô mỗi phút với quote bất biến; cập nhật live hai app.
- Non-functional: 200k tài xế online, 800 yêu cầu/s đỉnh, ứng viên < 2 s, time-to-match < 30 s p95; bất biến một tài xế một chuyến; vị trí cũ vài giây chấp nhận; mở rộng 50 thành phố.
### Ước lượng
| Đại lượng | Tính | Kết quả |
|---|---|---|
| Vị trí ghi | 200k / 4 s | 50k/s, ~2,5 MB/s; RAM vị trí mới nhất ~20 MB |
| Yêu cầu | 50k/phút | ~800/s |
| ETA | 800 × 10 ứng viên | 8 000/s → cache theo cặp cell |
| Cell geohash 6 | ~1,2 × 0,6 km | ~1 500 ô/thành phố, 130 tài xế/ô TB, 2 000 ở trung tâm |
| Kết nối live | 200k driver + 100k rider | 300k WS → ~15 gateway node |
| Trip | 3 triệu/ngày × 2 KB | 6 GB/ngày, partition theo tháng |
### Thiết kế tổng thể
:::diagram
DApp[Driver app] -> LGW[Location gateway WS] : vị trí mỗi 4 s
LGW -> Loc[Location service Redis GEO theo cell, TTL 30 s]
RApp[Rider app] -> API[Trip API]
API -> Quote[Pricing/Surge service] : quote_id
API -> Trips[Postgres trips/offers/quotes]
API -> Match[Matching service shard theo vùng]
Match -> Loc : cell + 8 lân cận
Match -> ETA[Routing/ETA + cache cặp cell]
Match -> DState[Redis driver_state CAS lock]
Match -> Push[Push/WS gateway] : offer
Push -> DApp
Push -> RApp : trạng thái live
Match -> Trips : accepted
Loc -> Bus[Event bus] : cung/cầu theo cell
Bus -> Quote
:::
- Luồng ghi vị trí: driver gửi (lat, lon, ts, status) → gateway → Location service: GEOADD/ZADD vào key cell:{geohash6} với TTL 30 s, cập nhật driver:{id} (cell, ts); tài xế đổi cell → xóa khỏi cell cũ. Không chạm Postgres; lịch sử đẩy ra event bus nếu cần.
- Luồng ghép: rider lấy quote (giá + surge + ETA đón, hết hạn 2 phút) → POST /trips(quote_id) → trip requested → Matching: lấy tài xế rảnh trong cell đón + 8 lân cận (lọc ts < 15 s, khoảng cách < 3 km) → top 20 theo haversine → ETA cho top 10 (cache theo cặp cell) → xếp theo ETA + rating → offer tuần tự: CAS driver_state available→offered (TTL 20 s) → push → chờ 15 s → accept: CAS offered→busy + INSERT trips driver_id (UNIQUE partial WHERE status active) → thông báo rider; decline/timeout: CAS về available → tài xế tiếp theo; hết ứng viên → mở rộng bán kính 1 lần → không có → báo rider.
- API: WS /driver/location; POST /quotes; POST /trips; GET /trips/{id}/stream (SSE/WS); POST /offers/{id}/accept, /decline; PATCH /driver/status.
- Dữ liệu: trips(id, rider_id, driver_id, status, quote_id, surge, pickup_cell, version, created_at) + UNIQUE (driver_id) WHERE status IN (accepted, arriving, in_progress); offers(id, trip_id, driver_id, sent_at, expires_at, response, version); quotes(id, rider_id, from, to, surge, base_price, eta, expires_at); Redis: cell:{gh6} sorted set, driver:{id} hash (status, trip_id, cell, ts), surge:{cell}:{window}.
### Đào sâu
**1. Tìm lân cận.** Geohash cấp 6 cho thành phố; truy vấn cell + 8 lân cận giải quyết tài xế ở ngay bên kia biên ô. Ô quá đông (trung tâm 2 000 tài xế): chỉ lấy tài xế cập nhật trong 15 s và dùng cấp 7 cho các ô có mật độ > 500 (adaptive); hoặc H3 (ô lục giác, lân cận đều hơn) nếu stack có sẵn. Quadtree trong RAM thích nghi mật độ tốt hơn nhưng rebuild liên tục với 50k cập nhật/s — không đáng với lợi ích.
**2. Bất biến một tài xế một chuyến.** Lớp nhanh: Lua CAS trên driver:{id}.status (available → offered → busy) kèm trip_id và TTL cho trạng thái offered; hai matching shard cùng chọn một tài xế thì chỉ một CAS thắng. Lớp bền: trips có UNIQUE partial index trên driver_id khi status active — nếu Redis mất dữ liệu (failover), DB vẫn từ chối chuyến thứ hai và matching phải xử lý lỗi đó bằng cách chọn tài xế khác. Accept đến muộn (sau timeout): offer có version; accept chỉ hợp lệ nếu UPDATE offers SET response = accepted WHERE id = $1 AND response IS NULL AND expires_at > now() ảnh hưởng 1 row — nếu 0 row thì trả "offer đã hết hạn".
**3. ETA và surge.** ETA: gọi routing engine với timeout 300 ms cho top 10, cache 60 s theo cặp (cell tài xế, cell đón) vì tài xế cùng ô có ETA gần nhau; routing chậm/chết → fallback haversine × hệ số theo giờ (đo từ lịch sử), ghi flag eta_estimated. Surge: counter yêu cầu và tài xế rảnh theo cell mỗi phút từ event bus → multiplier = f(cầu/cung) làm mượt EMA, bước tối đa 0,2/phút → quote lưu surge lúc báo giá; trip tham chiếu quote_id → tính tiền dùng surge trong quote, không dùng surge hiện tại.
**4. Scale và failover.** Matching shard theo thành phố (50 shard), mỗi shard là một nhóm instance active-passive với lease trong Redis/etcd; trạng thái ghép nằm trong Redis (driver_state, offers đang mở có TTL) nên shard mới tiếp quản bằng cách quét offers hết hạn và trip ở trạng thái matching quá 30 s để chạy lại. Gateway WebSocket không giữ logic, chỉ map user → kết nối; push qua Redis pub/sub channel theo user.
### Trade-off
| Lựa chọn | Được | Mất |
|---|---|---|
| Vị trí trong Redis theo cell + TTL | 50k ghi/s dễ dàng, offline detection miễn phí | Mất vị trí khi Redis failover (tự hồi sau 4 s), không có lịch sử |
| Offer tuần tự | Công bằng, không tranh chấp giữa tài xế, đơn giản | Time-to-match chậm hơn broadcast (15 s mỗi vòng) |
| CAS Redis + unique DB | Nhanh và an toàn | Hai nơi phải nhất quán, cần xử lý lỗi unique ở matching |
| Quote bất biến | Giá minh bạch, không tranh cãi | Rider có thể "khóa" giá tốt 2 phút khi surge tăng |
### Nói thế nào trong phỏng vấn (EN)
- "Locations change every four seconds, so they live in memory keyed by geohash cell with a TTL; trips and prices must be remembered, so they live in Postgres." — Vị trí ở RAM theo cell, chuyến ở Postgres.
- "The only invariant is one driver, one trip: a compare-and-set in Redis makes it fast, a partial unique index in Postgres makes it true." — CAS cho nhanh, unique index cho đúng.
- "Pricing is frozen in a quote at booking time, so what we show is what we charge, even if surge changes during the ride." — Giá đóng băng trong quote.`
});
