/* ===== Hướng dẫn: cách làm đề, cách luyện, dùng vào công việc, tài nguyên ===== */
window.GUIDES = {
method: { title: 'Cách làm đề system design', sub: 'Khung 5 pha · 45 phút · tự chấm bằng rubric · luyện một mình thế nào', sections: [
{ id: 'frame', title: 'Khung 5 pha và phân bổ thời gian', md: `
Mọi đề mock trong app chạy theo đúng khung này. Thuộc nó như thuộc bảng cửu chương, để trong phòng phỏng vấn bạn không phải nghĩ "tiếp theo làm gì".

| Pha | Phút (45) | Phút (60) | Bạn làm gì | Người phỏng vấn muốn thấy |
|---|---|---|---|---|
| 1. Làm rõ yêu cầu | 5 | 7 | Hỏi 5–8 câu, chốt functional / non-functional / ngoài phạm vi, viết lên bảng | Bạn không nhảy vào giải pháp; bạn biết cái gì quan trọng nhất |
| 2. Ước lượng | 5 | 6 | DAU → QPS đọc/ghi (trung bình, đỉnh), dung lượng/năm, băng thông, cache | Con số dẫn tới quyết định: có cần shard, cache bao nhiêu, bao nhiêu máy |
| 3. Thiết kế tổng thể | 12 | 15 | Sơ đồ 6–10 khối, luồng ghi, luồng đọc, API chính, mô hình dữ liệu | Thiết kế đơn giản nhất đáp ứng yêu cầu, đúng luồng, biết điểm nghẽn |
| 4. Đào sâu | 18 | 25 | 2–3 điểm nóng: mỗi điểm 2–3 phương án → chọn → failure mode → vận hành | Trade-off thật, kinh nghiệm thật, nói được "khi nào không dùng" |
| 5. Tổng kết | 5 | 7 | Tóm tắt, điểm yếu còn lại, bước tiếp theo nếu có thêm thời gian; trả lời câu vặn | Tự nhận biết giới hạn thiết kế của mình |

Quy tắc vàng theo pha:
- **Pha 1:** câu đầu tiên luôn là "Who are the users and what is the core use case?". Chốt bằng cách đọc lại: "So to confirm: we need A, B, C; we optimize for X over Y; D is out of scope. Correct?"
- **Pha 2:** viết phép tính ra, làm tròn (1 ngày ≈ 10^5 giây). Kết thúc bằng một câu kết luận: "So roughly 1,200 writes/s and 120k reads/s: read-heavy, cache is mandatory, a single Postgres can take the writes."
- **Pha 3:** vẽ từ trái sang phải theo luồng request. Mỗi khối thêm vào phải nói vì sao cần. Nói rõ dữ liệu nằm ở đâu và key là gì.
- **Pha 4:** hỏi người phỏng vấn muốn đào sâu điểm nào trước ("Which part would you like me to go deeper on: the fan-out or the storage?"). Mỗi điểm: vấn đề → phương án → chọn → điều gì hỏng khi nó hỏng → đo bằng metric gì.
- **Pha 5:** đừng xin lỗi. Nói "If I had another hour I would look at X and Y."
` },
{ id: 'clarify', title: 'Pha 1: bộ câu hỏi làm rõ dùng được cho mọi đề', md: `
Hỏi theo thứ tự, mỗi câu dưới 10 giây:

1. **Người dùng & use case lõi:** ai dùng, hành động quan trọng nhất là gì, mobile hay web, B2B (tenant) hay B2C?
2. **Quy mô:** DAU, hành động/người/ngày, tỉ lệ đọc/ghi, kích thước bản ghi, dữ liệu giữ bao lâu?
3. **Độ trễ:** p99 cần bao nhiêu cho đọc, cho ghi? Có phần nào realtime không?
4. **Tính sẵn sàng vs đúng đắn:** chấp nhận dữ liệu cũ vài giây không? Phần nào tuyệt đối không được sai (tiền, tồn kho)?
5. **Phạm vi:** có cần auth, analytics, admin, multi-region không? (Thường là không, hãy đề nghị để ngoài phạm vi.)
6. **Ràng buộc:** cloud nào, có sẵn hạ tầng gì, team nhỏ hay lớn, chi phí có là ưu tiên?

Chốt lại trên bảng ở dạng 3 cột: Functional (3–6 dòng) · Non-functional (độ trễ, sẵn sàng, nhất quán, quy mô, độ bền) · Ngoài phạm vi. Mọi quyết định ở pha 3–4 đều trỏ về cột 2.

Sai lầm hay gặp: hỏi 15 câu rồi không chốt; hỏi những câu không ảnh hưởng thiết kế ("màu nút là gì"); không ghi lại nên pha 4 quên mất đã hứa gì.
` },
{ id: 'estimate', title: 'Pha 2: công thức ước lượng và cách trình bày', md: `
| Đại lượng | Công thức | Ví dụ 100M DAU, 1 ghi + 10 đọc / người / ngày |
|---|---|---|
| Ghi/giây | DAU × ghi/ngày / 10^5 | 100M × 1 / 10^5 = 1 000 ghi/s |
| Đọc/giây | DAU × đọc/ngày / 10^5 | 100M × 10 / 10^5 = 10 000 đọc/s |
| Đỉnh | × 2–3 | 3 000 ghi/s, 30 000 đọc/s |
| Dung lượng/năm | ghi/ngày × kích thước × 365 | 100M × 1 KB × 365 ≈ 36,5 TB/năm |
| Băng thông vào | ghi/s × kích thước | 1 000 × 1 KB = 1 MB/s |
| Băng thông ra | đọc/s × kích thước | 10 000 × 1 KB = 10 MB/s |
| Cache (80/20) | 20% dữ liệu đọc trong ngày | 100M × 10 × 1 KB × 20% ≈ 200 GB |

Cách nói: "Let me do a quick back-of-the-envelope. Assuming 100 million DAU and each user writes once and reads ten times a day, that is about one thousand writes per second and ten thousand reads per second, peak three times that. Storage grows about 36 terabytes a year. So: read-heavy, cache-first, and a single relational primary handles the write path for the first few years."

Kết luận ước lượng phải trả lời được: cần shard DB không (ghi > vài nghìn/s hoặc dữ liệu > vài TB trên một node), cache bao nhiêu GB (vừa một Redis node 64 GB không), bao nhiêu máy stateless (RPS / vài nghìn), queue cần bao nhiêu partition (throughput / 10 MB/s mỗi partition).

Dùng trang **Máy tính ước lượng** để luyện; mục tiêu là làm nhẩm được trong 3 phút không cần máy.
` },
{ id: 'hld', title: 'Pha 3: sơ đồ tổng thể đúng cách', md: `
Trình tự vẽ (nói to từng bước):
1. Client → (CDN) → Load balancer → API/stateless service. Nói "stateless so we can scale horizontally".
2. Dữ liệu chính nằm đâu: relational (quan hệ, giao dịch) hay key-value/wide-column (scale ghi, access pattern đơn giản). Nêu key/partition key ngay.
3. Cache trước DB cho đường đọc nóng; nói chiến lược (cache-aside) và TTL.
4. Việc chậm hoặc có thể hỏng (gửi email, gọi API ngoài, xử lý file) tách ra queue + worker. Nói delivery semantics (at-least-once + idempotent).
5. Object storage cho file; CDN trước nó.
6. Observability và admin để ngoài sơ đồ, nhắc một câu.

Mỗi khối một câu "vì sao có nó". Kết thúc bằng hai luồng: "On the write path: ...; on the read path: ...". Rồi API chính (3–6 endpoint) và mô hình dữ liệu (bảng chính, key, index chính).

Sai lầm hay gặp: vẽ Kafka + Cassandra + Elasticsearch cho hệ 1 000 ghi/s (over-engineering); vẽ ô "Microservices" không có nội dung; quên nói dữ liệu đi theo đường nào; không nêu key nên pha 4 không shard được.
` },
{ id: 'deep', title: 'Pha 4: đào sâu như một senior', md: `
Chọn điểm nóng bằng cách hỏi người phỏng vấn, hoặc tự chọn theo thứ tự: (1) điểm nghẽn theo số liệu pha 2, (2) chỗ dữ liệu có thể sai hoặc mất, (3) chỗ phụ thuộc bên ngoài.

Mẫu trình bày một điểm (5–6 phút):
- **Vấn đề:** "At 30k reads/s with a celebrity user, fan-out on write means one post triggers 10M writes."
- **Phương án:** 2–3 cái, mỗi cái một câu ưu, một câu nhược (vẽ bảng nhỏ).
- **Chọn:** "I'd go hybrid: fan-out on write for normal users, on read for accounts above 1M followers."
- **Failure mode:** "If the fan-out workers lag, feeds go stale; we monitor queue lag and degrade by merging on read."
- **Vận hành:** metric nào, alert nào, rollback thế nào, migration dữ liệu ra sao.

Những điểm nóng xuất hiện trong hầu hết đề: hot key / hot partition; idempotency khi retry; consistency giữa cache và DB; ordering trong queue; thundering herd khi cache mất; scale WebSocket stateful; giao dịch nhiều bước (saga/outbox); dữ liệu lớn (phân trang, stream thay vì load hết); rate limit API ngoài.

Khi không biết: "I haven't run X in production, but based on how Y works I'd expect Z; I'd verify by measuring W." Thừa nhận nhanh, đề xuất cách kiểm chứng. Đừng bịa.
` },
{ id: 'rubric', title: 'Tự chấm bằng rubric 5 tiêu chí (0–3)', md: `
Sau mỗi mock, app bắt bạn chấm 5 tiêu chí, mỗi tiêu chí 0–3, tổng 15. Mô tả từng mức hiện ngay trong trang chấm. Thang quy đổi để bạn biết mình đang ở đâu:

| Tổng | Ý nghĩa |
|---|---|
| 0–5 | Chưa có khung; học lại F1–F2, làm theo khung từng pha có gợi ý |
| 6–8 | Có khung nhưng thiếu số liệu hoặc trade-off; mục tiêu cuối Giai đoạn 2 |
| 9–11 | Đậu vòng mid ở phần lớn công ty; mục tiêu cuối Giai đoạn 3 |
| 12–15 | Tín hiệu senior: trade-off, failure mode, vận hành; mục tiêu cuối Giai đoạn 4 |

Chấm thật. Nếu bạn mở gợi ý trong khi làm, trừ 1 điểm ở tiêu chí tương ứng (app ghi số lần mở gợi ý). Checklist từng pha chỉ là "độ phủ"; rubric mới là chất lượng. Một bài phủ 90% checklist vẫn có thể được 7/15 nếu chỉ liệt kê mà không so sánh.
` },
{ id: 'solo', title: 'Luyện một mình cho hiệu quả', md: `
1. **Nói to, ghi âm.** Bật ghi âm điện thoại khi làm mock. Nghe lại 10 phút đầu: bạn có hỏi làm rõ không, có kết luận sau ước lượng không, có khoảng im lặng quá 30 giây không.
2. **Viết lên bảng thật.** Dùng Excalidraw hoặc giấy. Tốc độ vẽ là một kỹ năng; luyện vẽ 8 khối + mũi tên trong 3 phút.
3. **Làm lạnh → đọc → ghi khác biệt → làm lại rút gọn.** Đây là vòng lặp của Giai đoạn 3. Khác biệt ghi vào Sổ tay dạng "Tôi đã..., lời giải..., vì...".
4. **Dùng AI làm người phỏng vấn.** Dán prompt dưới đây vào một trợ lý AI, rồi làm đề bằng cách gõ/nói; yêu cầu nó không gợi ý trừ khi bạn hỏi. Cuối buổi yêu cầu nó chấm theo đúng 5 tiêu chí.
5. **Mỗi tuần một buổi với người thật** nếu có thể (đồng nghiệp, bạn, cộng đồng mock). Người thật phản ứng với cách bạn dẫn dắt, điều AI làm kém.

Prompt mẫu cho AI (sao chép):

~~~
You are a senior staff engineer running a 45-minute system design interview.
Problem: <dán đề>.
Rules: Ask me to drive. Only answer my clarifying questions with realistic assumptions; do not volunteer hints unless I explicitly ask for one (and count how many hints I used). Push back on vague statements with "why" and "what breaks when". Keep time: tell me when 5, 10, 22, 40 minutes have passed.
At the end, grade me 0-3 on: requirements, estimation, high-level design, deep dive and trade-offs, communication. Quote specific things I said for each score and list the 3 most important gaps.
~~~
` },
{ id: 'mistakes', title: '12 sai lầm khiến người có kinh nghiệm vẫn trượt', md: `
1. Nhảy vào giải pháp trong 60 giây đầu.
2. Không có con số nào trong 45 phút.
3. Over-engineering: kéo đủ Kafka, Cassandra, Elasticsearch vào hệ 500 request/s.
4. Nói tên công nghệ thay vì tính chất ("dùng Redis" thay vì "cần cache in-memory với TTL và eviction LRU, Redis là lựa chọn hợp lý vì...").
5. Không nói luồng dữ liệu; sơ đồ là tập hợp ô không có mũi tên có nghĩa.
6. Không nêu key/partition key → không nói được shard, hot key.
7. Bỏ qua failure mode: điều gì xảy ra khi cache chết, queue đầy, API ngoài timeout.
8. Không nhắc idempotency khi có retry.
9. Im lặng lâu hoặc nói liên tục không xác nhận với người phỏng vấn.
10. Tranh cãi khi bị đẩy ngược thay vì cân nhắc rồi quyết.
11. Không quản lý thời gian: pha 3 ăn 25 phút, không còn thời gian đào sâu.
12. Kết thúc bằng xin lỗi thay vì tóm tắt và nêu bước tiếp theo.
` },
{ id: 'priority', title: 'Khi lịch phỏng vấn tới sớm: ưu tiên thế nào', md: `
Lộ trình 24 tuần được thiết kế cho người có thời gian. Thực tế thì lịch phỏng vấn đến bất ngờ, và câu hỏi đúng lúc đó không phải "học thêm gì" mà **"bỏ gì"**. Dưới đây là thứ tự ưu tiên đã rút gọn theo thời gian còn lại.

### Quy tắc chung
- **Dừng lộ trình, đừng cố chạy song song.** Ghi lại tuần đang dở, chuyển hẳn sang chế độ chuẩn bị, xong thì quay lại đúng chỗ đó. Chạy hai thứ cùng lúc là làm hỏng cả hai.
- **Mock đắt giá hơn đọc.** Một mock lạnh 45 phút có tự chấm bằng rubric dạy nhiều hơn ba giờ đọc case. Nếu chỉ còn vài buổi, dùng gần hết cho mock.
- **Bài đã học mà quiz dưới 7/8 thì ôn lại; bài chưa học thì bỏ qua không tiếc.** Lấp lỗ hổng rẻ hơn mở mặt trận mới.

### Còn 4 tuần trở lên
Chạy trọn kế hoạch 4 tuần trong tab **Job** nếu đúng công ty đó, hoặc tự soạn theo cùng khuôn: tuần 1 ngôn ngữ và nền tảng của JD, tuần 2 framework và testing, tuần 3 dữ liệu và một mock nghiệp vụ, tuần 4 CI/CD, hai mock còn lại và behavioral. Mỗi tuần một mock lạnh, không ngoại lệ.

### Còn 2 tuần
- Ngày 1–2: đọc kỹ JD, điền ma trận khớp kỹ năng, liệt kê 5 chỗ yếu nhất và chỉ nhận 3 chỗ để vá.
- Ngày 3–8: mỗi ngày một mock lạnh (ưu tiên đề trong **kho mock dự phòng** vì bạn chưa từng thấy), tự chấm, ghi 3 khác biệt, hôm sau đọc case tương ứng.
- Ngày 9–11: viết và tập 6 câu chuyện STAR, mỗi câu dưới 2 phút; ôn flashcard D1, D2, D8, D9.
- Ngày 12–13: một buổi mô phỏng đầy đủ liền mạch — test 30 phút, mock 45 phút, 3 câu behavioral.
- Ngày 14: nghỉ, đọc checklist ngày phỏng vấn, ngủ sớm.

### Còn 1 tuần
Bỏ hết phần đọc mới. Lịch cố định: 3 mock lạnh (một đề dễ, một trung bình, một khó), 1 bài test kiến thức để biết topic yếu, ôn **duy nhất** các topic dưới 60% trong kết quả test, viết STAR, tập nói pitch 90 giây. Đọc lại mục "12 sai lầm" ngay trước buổi phỏng vấn.

### Còn 2 ngày
Không học gì mới. Làm đúng ba việc: (1) một mock lạnh để làm nóng khung 5 pha, (2) đọc lại flashcard số liệu (D1, D2) và bộ trade-off (D4) trong 30 phút, (3) chuẩn bị câu hỏi ngược cho người phỏng vấn và kiểm tra thiết bị, đường truyền, giấy bút. Phần còn lại dành cho ngủ.

### Sau buổi phỏng vấn, dù kết quả thế nào
Trong vòng 2 giờ, ghi vào Sổ tay: đề gì, bạn trả lời thế nào, câu nào bị vặn mà lúng túng, và ba thứ sẽ làm khác. Đây là nguồn dữ liệu tốt nhất bạn có để chỉnh lộ trình, và nó bay hơi rất nhanh nếu không ghi ngay.
` }
]},

knowledge: { title: 'Cách làm bài test kiến thức và hỏi nhanh', sub: 'KT0–KT4 · Oral 2 phút · Flashcard Leitner · Drill', sections: [
{ id: 'kt', title: 'Bài test trắc nghiệm (KT)', md: `
- 30 câu trong 30–40 phút: khoảng 1 phút/câu. Câu nào quá 90 giây thì đánh dấu, đi tiếp, quay lại cuối giờ.
- Loại trừ trước, chọn sau. Đáp án sai trong bộ đề này đều "nghe hợp lý"; hãy tìm từ khoá sai (ví dụ "exactly-once ở tầng broker" là dấu hiệu đáp án sai).
- Câu tình huống ("hệ thống X có triệu chứng Y"): hỏi mình "triệu chứng này xuất hiện ở tầng nào trước" rồi mới chọn nguyên nhân. Bước xử lý đầu tiên luôn là **đo/xem log** chứ không phải sửa.
- Sau khi nộp, app hiện điểm theo topic và link bài học cho topic dưới 60%. Học lại bài đó trước khi làm KT tiếp theo. Đừng làm lại cùng một KT trong vòng 2 tuần; đáp án còn trong trí nhớ ngắn hạn.
- Mốc: KT0 là baseline, không cần cao. KT1 ≥ 21, KT2 ≥ 22, KT3 ≥ 24, KT4 ≥ 26 trên 30.
` },
{ id: 'oral', title: 'Hỏi nhanh (Oral) 2 phút', md: `
Mô phỏng phần "kiến thức" của buổi phỏng vấn: người phỏng vấn hỏi một câu ngắn, bạn trả lời trong 1–2 phút. Khung trả lời 4 bước:

1. **Định nghĩa một câu** ("Idempotency means applying the same request twice has the same effect as once").
2. **Vì sao cần** (vấn đề nó giải quyết).
3. **Trade-off hoặc cách làm** (một kỹ thuật cụ thể, một con số nếu có).
4. **Ví dụ thật** từ công việc của bạn, một câu.

Trong app: bấm "Câu ngẫu nhiên", nói to (bấm giờ 2 phút), rồi mở đáp án mẫu và tự chấm Biết rõ / Mơ hồ / Không biết. Câu "Không biết" quay lại ngày mai, "Mơ hồ" sau 3 ngày, "Biết rõ" sau 7 ngày rồi 14 ngày. Mục tiêu cuối lộ trình: 90 câu đều ở mức "Biết rõ" ít nhất hai lần liên tiếp.
` },
{ id: 'cards', title: 'Flashcard Leitner và Drill', md: `
- 5 hộp, chu kỳ 1 / 2 / 4 / 8 / 16 ngày. Nhớ → lên hộp; quên → về hộp 1. 10–15 phút mỗi ngày, thẻ đến hạn trước, thẻ mới sau (mặc định 15 thẻ mới/ngày, chỉnh ở Cài đặt).
- Bộ D1 (latency numbers) và D2 (rule of thumb) phải thuộc từ tuần 3; chúng là nguyên liệu cho pha ước lượng.
- Bộ D4 (trade-off) và D5 (pattern) là thứ bạn nói trong pha đào sâu. Khi lật thẻ, nói to câu trả lời bằng tiếng Anh trước khi xem mặt sau.
- **Drill** trộn câu hỏi quiz từ mọi bài đã học. Câu sai được ghi lại; làm Drill "chỉ câu sai" mỗi thứ Bảy đến khi danh sách trống.
` }
]},

real: { title: 'Dùng vào công việc thật', sub: 'Design doc · ADR · capacity plan · production readiness · postmortem · thói quen thứ Sáu', sections: [
{ id: 'habit', title: 'Thói quen "Áp dụng thứ Sáu"', md: `
Mỗi bài học có mục **Áp dụng vào hệ thống SBOM của bạn** với việc cụ thể. Mỗi thứ Sáu chọn một việc, làm trong 60–90 phút tại công ty, ghi vào Sổ tay. Ba loại việc, xoay vòng:

| Loại | Ví dụ | Đầu ra |
|---|---|---|
| Đo | Lấy p95 của một endpoint, đếm connection pool đang dùng, xem consumer lag, EXPLAIN một query chậm | Một con số + ảnh chụp dashboard trong Sổ tay |
| Sửa nhỏ | Thêm timeout cho một call ra ngoài, thêm partial index, thêm metric "last success", thêm memory limit cho một container | Một PR nhỏ, có số trước/sau |
| Viết | Một ADR cho quyết định đã có nhưng chưa ghi; một design doc 1 trang cho việc sắp làm; một postmortem cho sự cố cũ | Một tài liệu được đồng nghiệp đọc |

Sau 24 tuần bạn có khoảng 20 mục: đó là bằng chứng "senior" thật sự, và là 6 câu chuyện STAR cho vòng behavioral.
` },
{ id: 'designdoc', title: 'Mẫu design doc 1–2 trang', md: `
~~~
# <Tên thay đổi>            Tác giả · Ngày · Trạng thái: Draft / In review / Approved
## 1. Bối cảnh
Hệ thống hiện tại làm gì, vấn đề là gì, số liệu chứng minh (p95, lỗi/ngày, chi phí).
## 2. Mục tiêu / Không phải mục tiêu
Goals: 3 gạch đầu dòng đo được. Non-goals: điều cố tình không làm lần này.
## 3. Đề xuất
Sơ đồ. Luồng chính. API/schema thay đổi. Delivery semantics. Giới hạn (timeout, retry, rate limit, memory).
## 4. Phương án thay thế đã cân nhắc
Mỗi phương án: 1 dòng mô tả, vì sao không chọn.
## 5. Rủi ro & cách giảm
Điều gì hỏng khi X hỏng; dữ liệu cũ có migrate không; tương thích N-1.
## 6. Kế hoạch triển khai
Expand → migrate → contract. Feature flag. Thứ tự deploy (consumer trước producer). Rollback thế nào.
## 7. Đo lường thành công
Metric nào, dashboard nào, alert nào. Khi nào coi là xong.
## 8. Câu hỏi mở
~~~

Viết bối cảnh bằng số liệu trước khi viết đề xuất. Design doc không có số là ý kiến, không phải thiết kế.
` },
{ id: 'adr', title: 'Mẫu ADR (Architecture Decision Record)', md: `
~~~
# ADR-<số>: <Quyết định, viết ở thì chủ động: "Dùng outbox pattern cho audit log">
Trạng thái: Proposed / Accepted / Superseded by ADR-<n>      Ngày:
## Bối cảnh
Vấn đề, ràng buộc, số liệu. 5–10 dòng.
## Quyết định
Một đoạn. Cái gì, ở đâu, với tham số nào.
## Phương án đã cân nhắc
- A: ... (bỏ vì ...)
- B: ... (bỏ vì ...)
## Hệ quả
Tốt: ... Xấu/chi phí: ... Việc phải làm thêm: ...
~~~

Khi nào viết ADR: mọi quyết định mà 6 tháng sau có người hỏi "sao hồi đó làm thế". Ví dụ từ hệ SBOM: chọn outbox thay vì publish trực tiếp; chọn Postgres advisory lock thay vì etcd cho scheduler; chọn overlay per-tenant thay vì tách bảng; đặt statement_timeout ở đâu. Một ADR 15 phút viết tiết kiệm nhiều giờ tranh luận lặp lại.
` },
{ id: 'capacity', title: 'Capacity planning worksheet', md: `
| Thành phần | Hiện tại | Giới hạn | % dùng | 6 tháng (×1,5) | 12 tháng (×2–3) | Hành động khi > 70% |
|---|---|---|---|---|---|---|
| API RPS đỉnh | | | | | | thêm instance / tối ưu endpoint nóng |
| Postgres kết nối | | max_connections | | | | pool nhỏ hơn, PgBouncer |
| Postgres CPU / IOPS | | | | | | index, read replica, partition |
| Bảng lớn nhất (dòng, GB) | | | | | | partition, archive, TTL |
| Redis bộ nhớ | | maxmemory | | | | eviction, tách cache nóng |
| Queue depth / consumer lag | | | | | | thêm consumer, batch |
| Worker RSS | | memory limit | | | | stream/paginate, GOMEMLIMIT |
| API ngoài (req/phút) | | quota | | | | rate limit client, cache |
| Lưu trữ object (GB) | | | | | | lifecycle |

Điền số thật mỗi quý. Cột "Giới hạn" phải là số đo (benchmark hoặc tài liệu), không phải cảm giác. Dòng nào không điền được là dòng bạn chưa có metric: đó là việc cần làm đầu tiên.
` },
{ id: 'prr', title: 'Production readiness checklist', md: `
Dùng trước khi đưa một service hoặc một thay đổi lớn lên production. Mỗi dòng trả lời có/không, không có "sắp".

**Giới hạn & bảo vệ**
- Mọi call ra ngoài (DB, HTTP, queue) có timeout tường minh; deadline truyền qua context.
- Retry chỉ cho thao tác idempotent, có backoff + jitter, có giới hạn.
- Có rate limit / concurrency limit cho API ngoài và cho mỗi tenant.
- Container có memory limit và CPU request; GOMEMLIMIT đặt theo limit.
- Query trên bảng lớn có index phục vụ; không có SELECT không giới hạn; pagination keyset.

**Dữ liệu**
- Migration theo expand → contract, không lock bảng lớn, tương thích phiên bản N-1.
- Backup có và đã thử restore ít nhất một lần.
- Dữ liệu dùng chung giữa tenant có quy tắc hợp nhất rõ ràng.

**Quan sát**
- Metric RED cho mọi endpoint; USE cho tài nguyên; consumer lag; last-success timestamp cho mọi job định kỳ.
- Alert theo triệu chứng (SLO burn) và alert "không có thành công trong N phút".
- Log có trace id, tenant id; không log secret.
- Runbook: 1 trang "khi alert X kêu thì xem gì, làm gì".

**Triển khai**
- Health check liveness/readiness thật (readiness kiểm tra phụ thuộc).
- Graceful shutdown: drain in-flight, đóng publisher/consumer đúng thứ tự.
- Image pin theo tag cố định hoặc digest; config qua env/secret manager, không bake vào image.
- Có kế hoạch rollback và đã diễn tập.
` },
{ id: 'postmortem', title: 'Mẫu postmortem (blameless)', md: `
~~~
# Postmortem: <tiêu đề ngắn>                 Ngày sự cố · Mức độ · Tác giả
## Tóm tắt (3 dòng)
Chuyện gì, ảnh hưởng ai bao lâu, nguyên nhân gốc một câu.
## Tác động
Số request lỗi / người dùng / tenant / thời gian / tiền (nếu có).
## Dòng thời gian (giờ UTC+7)
hh:mm sự kiện — phát hiện bởi (alert? khách hàng?) — hành động — kết quả
## Nguyên nhân gốc & yếu tố góp phần
5 whys. Phân biệt trigger (điều kích hoạt) và root cause (điều cho phép nó xảy ra).
## Điều đã tốt / chưa tốt / may mắn
## Hành động (mỗi dòng có người chịu trách nhiệm và hạn)
- Ngăn tái diễn: ...
- Phát hiện sớm hơn: ... (MTTD hiện tại → mục tiêu)
- Giảm tác động: ...
## Bài học cho thiết kế
Pattern nào đáng lẽ phải có (heartbeat metric, reconnect, isolate per item, memory limit...).
~~~

Viết trong 48 giờ sau sự cố. Không có tên người ở phần nguyên nhân. Hành động "nhắc mọi người cẩn thận hơn" không được tính; hành động phải là thay đổi hệ thống hoặc quy trình kiểm tra được.
` }
]},

resources: { title: 'Tài nguyên', sub: 'Sách · bài báo · blog · luyện mock · Go', sections: [
{ id: 'books', title: 'Sách (đọc theo thứ tự)', md: `
1. **Designing Data-Intensive Applications** — Martin Kleppmann. Nền tảng của Giai đoạn 2 (chương 5 replication, 6 partitioning, 7 transactions, 8 trouble with distributed systems, 9 consistency & consensus, 11 stream processing). Đọc song song tuần 6–13.
2. **System Design Interview — An Insider's Guide, vol. 1 và 2** — Alex Xu. Khung 4 bước và các bài kinh điển; Giai đoạn 3 của lộ trình bám sát danh sách bài này nhưng viết lại với trade-off và vận hành sâu hơn.
3. **Release It! (2nd ed.)** — Michael Nygard. Stability patterns: timeout, circuit breaker, bulkhead, steady state; đọc cùng F9, B17.
4. **Site Reliability Engineering** (Google, miễn phí online) — chương về SLO, monitoring, postmortem; đọc cùng B14, K10.
5. **Database Internals** — Alex Petrov (tùy chọn, cho B4/B6 sâu hơn).
6. **100 Go Mistakes and How to Avoid Them** — Teiva Harsanyi; đọc cùng K1.
` },
{ id: 'papers', title: 'Bài báo và tài liệu gốc nên đọc một lần', md: `
- Dynamo: Amazon's Highly Available Key-value Store (2007) — nền của C3.
- In Search of an Understandable Consensus Algorithm (Raft, 2014) — B6; xem thêm raft.github.io có mô phỏng trực quan.
- Kafka: a Distributed Messaging System for Log Processing (2011) — B8, C15.
- Bigtable (2006) và Cassandra (2010) — B4.
- The Google File System (2003) — B12.
- How to do distributed locking (Kleppmann, 2016) và phản hồi của antirez — B6.
- Jeff Dean, Numbers Everyone Should Know (slide "Building Software Systems at Google") — F1.
- Tài liệu chính thức: PostgreSQL (chương Indexes, Concurrency Control, Routine Vacuuming), Redis (docs về persistence, cluster, Lua scripting), RabbitMQ (Reliability Guide, Consumer Acknowledgements, Publisher Confirms), Kafka (Design section).
` },
{ id: 'web', title: 'Blog & kênh', md: `
- Engineering blog: Netflix TechBlog, Uber Engineering, Discord (bài "How Discord stores trillions of messages"), Cloudflare blog, Slack Engineering, Shopify Engineering, Stripe (bài về idempotency keys), Figma (bài về sharding Postgres).
- highscalability.com — kiến trúc thật của nhiều hệ thống.
- ByteByteGo (Alex Xu) newsletter/YouTube — ôn nhanh bằng hình.
- Martin Kleppmann, Marc Brooker (AWS), Jepsen (Kyle Kingsbury) — khi muốn hiểu sâu consistency.
- Excalidraw — luyện vẽ sơ đồ nhanh; nhiều công ty dùng chính nó trong phỏng vấn.
- Tài liệu interview-prep cũ của bạn (vitepress, thư mục Documents/interview-prep): DSA, Go/Python Q&A, follow-up questions — dùng cho phần coding không nằm trong app này.
` },
{ id: 'mock', title: 'Luyện mock với người thật', md: `
- interviewing.io, Pramp (nay thuộc Exponent), Hello Interview — mock system design miễn phí hoặc trả phí, có người thật.
- Cộng đồng: tìm 1–2 đồng nghiệp cùng luyện, đổi vai người phỏng vấn mỗi tuần; người phỏng vấn dùng đúng checklist + rubric trong app để chấm.
- Khi làm người phỏng vấn cho người khác, bạn học được nhiều hơn khi làm ứng viên: bạn thấy ngay những lỗi mình cũng mắc.
` },
{ id: 'go', title: 'Go và thực hành', md: `
- Lab trong app dùng Go 1.22+, docker compose (Postgres, Redis, RabbitMQ), k6 (load test), pprof. Mỗi lab 2–4 giờ.
- Thư viện gợi ý: pgx (Postgres), go-redis, amqp091-go (RabbitMQ), golang.org/x/sync (errgroup, semaphore, singleflight), prometheus/client_golang.
- Go by Example, Effective Go, The Go Memory Model, Go blog "Concurrency is not parallelism", "Go Concurrency Patterns: Pipelines and cancellation".
` }
]}
};
