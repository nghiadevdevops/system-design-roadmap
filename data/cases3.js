/* ===== Giai đoạn 3 · Bài toán kinh điển (bổ sung, C20–C23): trợ lý RAG, distributed cache, top-K/trending, ví điện tử & sổ cái ===== */
window.LESSONS_C3 = [
{ id: 'C20', type: 'case', topic: 'ai', title: 'Case: Design an AI assistant over private documents (RAG)', time: '90 phút',
  goal: 'Trình bày trọn bài trợ lý hỏi đáp trên tài liệu riêng trong 45 phút: tách đường ingest và đường hỏi, ước lượng dung lượng vector và chi phí token, chọn hạ tầng index có lý do, nói được cách chống rò rỉ chéo tenant và cách đo chất lượng bằng eval set.',
  md: `
## Đề bài
> "Design an AI assistant that answers questions over a company's private documents. About 200 customer organisations, 2 million document chunks in total, 5 thousand questions a day. Answers must cite their sources."

Dịch: Thiết kế trợ lý AI trả lời câu hỏi trên tài liệu riêng của doanh nghiệp. Khoảng 200 tổ chức khách hàng, tổng 2 triệu đoạn tài liệu, 5 nghìn câu hỏi mỗi ngày. Câu trả lời phải trích dẫn nguồn. Thời gian 45 phút.

Đây là đề "mới" nhưng chấm bằng tiêu chí cũ: bạn có tách được pipeline offline khỏi đường online không, có ước lượng bằng con số không, có xử lý đa tenant không, có đo được chất lượng không. Nền tảng ở B21.

## 1. Làm rõ yêu cầu (5 phút)
- Hỏi: Tài liệu từ đâu, đổi thường xuyên không? → Đáp: khách upload PDF/Word/Markdown và nối Confluence; sửa vài trăm tài liệu mỗi ngày.
- Hỏi: Dữ liệu các tổ chức có dùng chung không? → Đáp: **tuyệt đối không**; thêm nữa trong một tổ chức còn có phân quyền theo không gian làm việc.
- Hỏi: Trả lời sai thì hậu quả thế nào? → Đáp: mất niềm tin; vì vậy bắt buộc trích nguồn, và thà nói "không tìm thấy" còn hơn đoán.
- Hỏi: Yêu cầu độ trễ? → Đáp: phải thấy chữ chạy trong 1 giây; trả lời xong trong khoảng 10 giây là chấp nhận.
- Hỏi: Ngân sách? → Đáp: dưới 3 000 USD/tháng cho cả suy luận và embedding.
- Hỏi: Có yêu cầu dữ liệu không rời khu vực không? → Đáp: có hai khách EU yêu cầu; coi là ràng buộc tương lai gần.
- Hỏi: Có cần trợ lý thực hiện hành động (tạo ticket, sửa tài liệu) không? → Đáp: giai đoạn này **chỉ đọc**.

Chốt lại:
- **Functional**: nạp và cập nhật tài liệu; hỏi đáp có trích nguồn; theo dõi lịch sử hội thoại ngắn; phản hồi thích/không thích; trang quản trị xem nguồn đã nạp.
- **Non-functional**: cách ly tuyệt đối giữa tổ chức và theo quyền xem; TTFT p95 dưới 1 s; chi phí trần theo tổ chức; chất lượng đo được, hồi quy phát hiện được.
- **Ngoài phạm vi**: huấn luyện mô hình riêng, trợ lý thực hiện hành động ghi, hỗ trợ đa ngôn ngữ ngoài Anh/Việt.

## 2. Ước lượng (5 phút)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Chunk | 2 triệu | 2 triệu vector |
| Vector thô | 2 triệu × 1 536 chiều × 4 byte | **12 GB** |
| Index HNSW | + khoảng 50% cho đồ thị | ~18 GB tổng, vừa RAM một máy 32 GB |
| Văn bản gốc | 2 triệu × 700 token × 3 byte | ~4 GB trong Postgres |
| QPS hỏi | 5 000/ngày ≈ 0,06 trung bình, đỉnh ×10 | **0,6 QPS** — nhỏ |
| Token mỗi câu | 6 chunk × 700 + 400 hệ thống | ~4 600 vào, ~400 ra |
| Token/tháng | 5 000 × 22 × 4 600 | ~506 triệu vào, 44 triệu ra |
| Chi phí suy luận | 506 × 3 + 44 × 15 USD | **~2 200 USD/tháng** |
| Embedding lần đầu | 2 triệu × 700 token = 1,4 tỉ token | một lần, vài trăm USD |
| Embedding cập nhật | 500 tài liệu/ngày × 20 chunk | 10k chunk/ngày — không đáng kể |

Hai kết luận phải nói thành lời: **QPS không phải vấn đề, tiền và chất lượng mới là vấn đề**; và **chi phí tỉ lệ thuận với số chunk nhét vào prompt**, nên giảm 6 chunk xuống 4 là tiết kiệm 30% chứ không phải chuyện nhỏ.

## 3. Thiết kế tổng thể (10–12 phút)
:::diagram
UP[Khách upload / Confluence] -> ING[Ingest API]
ING -> OBJ[Object storage bản gốc]
ING -> MQ[Queue tài liệu]
MQ -> PAR[Parser + chunk theo cấu trúc]
PAR -> PG[Postgres: chunk + metadata + quyền]
PAR -> EMB[Embedding worker batch]
EMB -> VEC[pgvector HNSW]
U[Người dùng] -> API[API hỏi đáp]
API -> AUTH[Kiểm quyền: org, workspace]
AUTH -> CA[Cache exact + ngữ nghĩa theo org]
AUTH -> RET[Retriever hybrid: vector + full-text]
RET -> VEC
RET -> RNK[Re-rank cross-encoder top 50]
RNK -> PRO[Dựng prompt theo ngân sách token]
PRO -> LLM[LLM provider]
LLM -> API : stream SSE
API -> LOG[Trace + log token + phản hồi]
LOG -> EV[Eval offline + dashboard chi phí]
:::

**Đường ingest** (offline): upload → lưu bản gốc → hàng đợi → parser cắt theo heading rồi theo kích thước 500–800 token chồng lấn 15% → ghi chunk kèm [[org_id]], [[workspace_id]], [[doc_id]], [[doc_version]], [[acl]] → đẩy sang embedding worker theo batch 64 → ghi vector. Tài liệu sửa thì **chỉ embed lại chunk đổi** (so hash nội dung chunk), đây là cách giữ chi phí embedding thấp.

**Đường hỏi** (online): kiểm quyền ở API → tra cache → truy hồi hybrid với [[WHERE org_id = ... AND workspace_id = ANY(...)]] **ngay trong truy vấn** → RRF → re-rank → cắt ngữ cảnh → gọi LLM → stream về bằng SSE kèm danh sách nguồn.

| Endpoint | Mô tả | Ghi chú |
|---|---|---|
| POST /v1/docs | Nạp tài liệu | trả job id, xử lý bất đồng bộ |
| GET /v1/docs/{id}/status | Trạng thái nạp | pending/chunked/embedded/failed |
| POST /v1/ask (SSE) | Hỏi, nhận token stream | kèm sources ở sự kiện cuối |
| POST /v1/feedback | Thích/không thích + lý do | nguồn cho eval set |
| GET /v1/usage | Token đã dùng theo org | nền cho hạn mức |

| Bảng | Khoá | Ghi chú |
|---|---|---|
| documents | (org_id, doc_id) | nguồn, version, trạng thái |
| chunks | (org_id, chunk_id) | text, doc_id, ord, hash, acl, token_count |
| chunk_vectors | (chunk_id, embedding_version) | vector; index HNSW; **cho phép hai version cùng tồn tại** |
| ask_logs | (org_id, ts) | câu hỏi, chunk đã dùng, token, chi phí, phản hồi |

## 4. Đào sâu (15–18 phút)
### 4.1 Cách ly đa tenant: chỗ dễ trượt nhất
Ba lớp, phải nói đủ: (1) [[org_id]] là **điều kiện trong truy vấn vector**, không lọc sau top-k; (2) khoá cache gồm org và tập quyền đã chuẩn hoá — thiếu chỗ này là một người thấy câu trả lời dựng từ tài liệu người khác; (3) quyền kiểm ở **API**, không nhờ prompt dặn mô hình. Nói thêm: khi quyền của người dùng bị thu hồi, câu trả lời cũ trong lịch sử hội thoại vẫn còn — cần quyết định chính sách (ẩn, hay giữ nguyên) và nói ra.

### 4.2 Chất lượng truy hồi: tại sao hybrid
Người dùng doanh nghiệp gõ mã hợp đồng, tên module, số hiệu quy trình. Vector thuần trượt những thứ đó. Chạy song song pgvector và [[tsvector]], trộn RRF (k = 60), lấy 50, re-rank cross-encoder còn 6. Nếu điểm re-rank cao nhất dưới ngưỡng thì **không gọi LLM**, trả "không tìm thấy trong tài liệu của bạn" — đúng yêu cầu "thà không biết còn hơn đoán", và tiết kiệm tiền.

### 4.3 Dựng prompt theo ngân sách token
Thứ tự cố định: hướng dẫn hệ thống (tĩnh, đặt đầu để được cache phía nhà cung cấp) → tóm tắt hội thoại → các chunk có đánh số nguồn → câu hỏi. Cắt theo ngân sách: tối đa 5 000 token ngữ cảnh, bỏ chunk điểm thấp trước. Bắt mô hình trích dẫn theo số [1], [2] và **validate sau khi sinh**: nguồn được trích phải nằm trong tập chunk đã gửi; nếu không thì đánh dấu câu trả lời là không đáng tin và ghi vào metric bịa đặt.

### 4.4 Cập nhật và version hoá index
Tài liệu sửa: so hash từng chunk, chỉ embed chunk đổi, xoá chunk biến mất. Đổi mô hình embedding: ghi vector mới với [[embedding_version = 2]] song song, chạy eval set so recall@5 giữa hai version, đổi con trỏ active bằng một lần cập nhật cấu hình, giữ version 1 một tuần. Đây là blue-green cho index (B18, B21).

### 4.5 Chi phí và hạn mức
Dashboard chi phí theo org là tính năng, không phải việc nội bộ: bán theo gói thì phải đo được. Hạn mức tính bằng **token**, không bằng request (B9): token bucket theo org với dung lượng ngày. Ba đòn giảm giá theo thứ tự hiệu quả: cache ngữ nghĩa (ngưỡng 0,96, TTL 1 giờ, key có org) → giảm số chunk → mô hình nhỏ hơn cho câu hỏi dễ (định tuyến theo độ khó, đo bằng eval trước khi bật).

### 4.6 Độ trễ và degrade
Ngân sách: truy hồi 80 ms, re-rank 150 ms, TTFT 600 ms, sinh 400 token trong 6–8 s. Stream SSE ngay token đầu. Khi nhà cung cấp chậm hoặc lỗi: timeout 30 s cho toàn phiên, circuit breaker, thử nhà cung cấp dự phòng một lần, cuối cùng rơi về **kết quả tìm kiếm thuần** kèm câu "trợ lý đang bận, đây là các đoạn liên quan nhất" — sản phẩm không chết theo nhà cung cấp.

### 4.7 Đo chất lượng
Eval set 150 câu có nhãn (câu hỏi, đáp án đúng, chunk đúng), lấy từ phản hồi thật và ticket hỗ trợ. Đo tách hai tầng: recall@5 và MRR cho retriever; tính trung thực và độ đúng cho phần sinh, chấm bằng LLM-as-judge đã hiệu chỉnh với 30 mẫu người chấm. Chạy trong CI mỗi lần đổi prompt/mô hình/chunk size; chặn merge nếu recall@5 tụt quá 2 điểm. Online: tỉ lệ không thích, tỉ lệ "không tìm thấy", tỉ lệ trích dẫn không hợp lệ, chi phí mỗi phiên, p95 TTFT.

## 5. Trade-off & câu hỏi vặn (5 phút)
- **pgvector hay vector DB riêng**: 2 triệu vector, 18 GB, lọc metadata phức tạp, đã có Postgres → pgvector thắng rõ. Ngưỡng đổi ý: quá ~10 triệu vector, hoặc cần scale index độc lập với OLTP.
- **Cache ngữ nghĩa**: tiết kiệm thật nhưng rủi ro trả nhầm câu gần nghĩa; chọn ngưỡng cao và TTL ngắn, đo bằng chính eval set.
- **Chunk lớn hay nhỏ**: lớn thì ngữ cảnh tốt nhưng đắt và loãng; đây là tham số phải tune bằng eval, không bằng cảm giác.
- **Tự host mô hình**: chỉ có lý khi khối lượng rất lớn hoặc ràng buộc dữ liệu; ở 5k câu/ngày thì tự host đắt hơn cả về tiền lẫn người.

### Sai lầm hay gặp
- Vẽ một đường duy nhất, trộn ingest vào đường hỏi.
- Không nói gì về đa tenant cho tới khi bị hỏi.
- Bỏ qua BM25, chỉ dùng vector.
- Không có ngưỡng "không trả lời", để mô hình luôn đoán.
- Không nhắc tiền, trong khi đây là đề mà tiền là ràng buộc chính.
- Nói "chúng tôi sẽ fine-tune" như giải pháp cho dữ liệu cập nhật.
- Quên trích dẫn và cách xác minh trích dẫn.
- Không có eval set; mọi cải tiến sau đó là mò.

## 6. Người phỏng vấn chấm gì
Tách hai đường rõ ràng; con số vector và token bật ra nhanh; lọc tenant đúng chỗ; hybrid + re-rank; có ngưỡng từ chối; có đường lui khi nhà cung cấp hỏng; có cách đo chất lượng và chặn hồi quy. Nếu nói được "nút thắt là truy hồi chứ không phải mô hình" thì bạn đã ở nhóm trên.

### Nói thế nào trong phỏng vấn (EN)
- "There are two independent pipelines here: an offline ingestion path that can fail and retry, and an online answer path with a one-second budget to first token." — Hai đường tách biệt.
- "Two million chunks at fifteen hundred dimensions is twelve gigabytes of vectors, so this fits comfortably in pgvector; I would not add a separate vector database for that." — Số liệu dẫn tới quyết định.
- "The tenant filter belongs inside the vector query and inside the cache key; filtering after top-k is both a leak and a recall bug." — Cách ly đúng chỗ.
- "If the best re-ranked score is below threshold I do not call the model at all and say I could not find it — that is cheaper and more trustworthy than guessing." — Ngưỡng từ chối.
- "I gate every prompt change on a labelled eval set in CI, measuring retrieval and generation separately." — Đo và chặn hồi quy.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Bản dựng nhỏ nhất đáng làm: trợ lý trả lời "component này vi phạm cái gì và tôi phải làm gì", nguồn là mô tả CVE (OSV/NVD), văn bản license, và rule policy của chính tenant. Phạm vi hẹp, có đáp án đúng để chấm, và giải đúng việc đang tốn thời gian hỗ trợ.
- Kiến trúc map thẳng: [[org_id]] trong bài này là [[tenant_id]] của bạn; tách shared và per-tenant đã có sẵn từ C19 nên **mô tả CVE và license text embed một lần dùng chung** — tiết kiệm lớn so với embed lại cho từng tenant, và đúng ranh giới dữ liệu công khai/riêng tư bạn đã định nghĩa.
- Ước lượng tại chỗ: khoảng 300k chunk (license text + CVE description + tài liệu policy) × 6 KB = **1,8 GB vector**, nhỏ hơn đề bài này 6 lần → pgvector trong Postgres hiện có, HNSW, không thêm hệ mới. Ghi lý do đó vào ADR để sau này không ai hỏi lại.
- Hybrid là bắt buộc chứ không phải tuỳ chọn: truy vấn thật sẽ là [[CVE-2024-3094]], [[pkg:maven/log4j-core@2.14.1]], [[AGPL-3.0]]. Nhánh từ khoá dùng [[tsvector]] ngay trong cùng một câu SQL với pgvector.
- Pipeline embedding dùng lại khung enrichment: bảng trạng thái pending/done/failed, [[attempts]], [[next_attempt_at]], **partial index trên pending** (sự cố #16), sweeper công bằng theo tenant (sự cố #8), batch có rate limit. Không viết mới.
- Ngưỡng từ chối quan trọng gấp đôi ở miền bảo mật: trả lời sai về license hoặc mức độ nghiêm trọng của CVE là rủi ro pháp lý cho khách. Quy tắc cứng: không đủ nguồn thì trả về đúng các đoạn trích, không sinh kết luận.
- Eval set lấy từ 80 ticket hỗ trợ thật đã có câu trả lời của bạn; chạy trong CI. Chỉ số theo dõi: recall@5, tỉ lệ trích dẫn hợp lệ, chi phí mỗi câu, p95 TTFT, tỉ lệ từ chối.
- Việc thứ Sáu: viết ADR một trang và một prototype đo recall@5 trên 20 câu bằng chính dữ liệu CVE đang có. Con số recall đó quyết định có làm tiếp hay không — và bản thân nó là một câu chuyện tốt cho phỏng vấn.
`,
  quiz: [
    { t: 'mc', q: 'Trong đề này, nút thắt thật sự của hệ là gì?', o: ['QPS: 5 000 câu/ngày là tải lớn cho tầng truy hồi', 'Chi phí token và chất lượng truy hồi, vì QPS chỉ khoảng 0,6 lúc đỉnh', 'Băng thông mạng khi stream token', 'Dung lượng đĩa cho 2 triệu chunk'], a: 1, why: '0,6 QPS là không đáng kể; tiền tỉ lệ với số chunk × số câu, còn chất lượng do retriever quyết định.' },
    { t: 'mc', q: '2 triệu chunk, embedding 1 536 chiều float32. Dung lượng vector thô và kết luận hạ tầng hợp lý nhất?', o: ['1,2 GB — dùng gì cũng được', '12 GB — vẫn nằm gọn trong pgvector với HNSW, chưa cần vector DB riêng', '120 GB — bắt buộc dùng vector DB phân tán', '12 GB — nhưng phải dùng vector DB riêng vì Postgres không index được vector'], a: 1, why: '1 536 × 4 = 6 KB mỗi vector; 2 triệu × 6 KB = 12 GB, cộng đồ thị HNSW khoảng 18 GB, vừa RAM một máy.' },
    { t: 'mc', q: 'Cache ngữ nghĩa được bật để giảm chi phí. Thiết kế khoá cache nào an toàn trong hệ đa tenant?', o: ['hash(câu hỏi)', 'hash(câu hỏi + mô hình)', 'hash(org_id + tập quyền đã chuẩn hoá + phiên bản prompt + mô hình + câu hỏi)', 'hash(user_id + câu hỏi) là đủ vì mỗi user chỉ thuộc một org'], a: 2, why: 'Thiếu org và tập quyền trong khoá là rò rỉ dữ liệu chéo; thiếu phiên bản prompt/mô hình là trả lời cũ sau khi đã nâng cấp.' },
    { t: 'mc', q: 'Người dùng hỏi một chuyện không có trong tài liệu. Hành vi thiết kế đúng nhất?', o: ['Vẫn gọi LLM và để nó trả lời bằng kiến thức chung', 'Nếu điểm re-rank cao nhất dưới ngưỡng thì không gọi LLM, trả lời không tìm thấy kèm gợi ý tìm kiếm', 'Tăng k lên 50 chunk rồi gọi LLM cho chắc', 'Trả lỗi HTTP 404'], a: 1, why: 'Ngưỡng từ chối vừa giữ niềm tin vừa tiết kiệm token; bịa trôi chảy là rủi ro lớn nhất của loại hệ này.' },
    { t: 'mc', q: 'Đổi mô hình embedding sang chiều khác trên hệ đang chạy. Cách làm đúng?', o: ['Embed dần tài liệu mới bằng mô hình mới, để tài liệu cũ nguyên', 'Ghi vector mới với embedding_version riêng song song, so eval set, đổi con trỏ active một lần, giữ version cũ một tuần', 'Xoá toàn bộ vector rồi backfill, chấp nhận tính năng hỏng vài giờ', 'Chuẩn hoá độ dài vector để hai mô hình dùng chung index'], a: 1, why: 'Vector hai mô hình khác hệ trục nên không so sánh được với nhau; đây là blue-green cho index.' },
    { t: 'fill', q: 'Điền: chạy song song tìm kiếm vector và tìm kiếm từ khoá rồi trộn thứ hạng, gọi là ___ search.', a: ['hybrid'], why: 'Cần thiết vì mã định danh chính xác (CVE, purl, mã hợp đồng) là điểm yếu của dense retrieval.' },
    { t: 'fill', q: 'Điền: tập câu hỏi có nhãn đáp án đúng và chunk đúng, dùng để đo recall@k và chặn hồi quy trong CI mỗi khi đổi prompt, gọi là ___ set.', a: ['eval', 'evaluation'], why: 'Không có eval set thì mọi thay đổi prompt đều là phỏng đoán; đây là tài sản quý nhất của tính năng.' },
    { t: 'open', q: 'Người phỏng vấn vặn: "Một khách hàng báo trợ lý trả lời cho họ bằng nội dung của khách hàng khác. Bạn điều tra thế nào và chữa ra sao?"', a: 'Trước hết coi là sự cố bảo mật mức cao: tắt tính năng hoặc tắt cache ngay để chặn lan rộng, rồi dùng ask_logs lấy đúng phiên đó ra vì log có lưu danh sách chunk_id đã đưa vào prompt. So org_id của các chunk đó với org_id của người hỏi để biết rò ở tầng nào. Ba giả thuyết theo thứ tự khả năng: khoá cache ngữ nghĩa hoặc cache exact thiếu org_id và tập quyền nên một câu hỏi giống nhau trả lời của tenant khác; truy vấn truy hồi lọc tenant sau khi lấy top-k hoặc một nhánh code mới quên mệnh đề WHERE org_id; hoặc tài liệu bị nạp sai org lúc ingest. Chữa: đưa org_id và tập quyền vào khoá cache và xoá toàn bộ cache hiện có, bắt buộc lọc tenant trong câu truy vấn bằng cách gói truy hồi sau một hàm duy nhất nhận org_id, thêm kiểm tra bất biến sau truy hồi rằng mọi chunk trả về đều thuộc org của người hỏi và bắn alert nếu vi phạm, thêm test hồi quy đa tenant vào CI, và soát lại dữ liệu đã nạp. Cuối cùng viết postmortem, thông báo cho khách theo nghĩa vụ hợp đồng, và thêm metric số lần kiểm tra bất biến thất bại để lần sau phát hiện trong vài phút.', keys: ['org_id', 'cache', 'lọc trong truy vấn', 'log', 'postmortem'] }
  ]
},

{ id: 'C21', type: 'case', topic: 'cache', title: 'Case: Design a distributed cache (Memcached / Redis cluster)', time: '90 phút',
  goal: 'Thiết kế một distributed cache từ đầu: consistent hashing và rebalancing, eviction LRU/LFU, hot key, replication và failover, client-side routing, và nói rõ vì sao cache không phải là database.',
  md: `
## Đề bài
> "Design a distributed in-memory cache like Memcached or Redis cluster. It should serve 1 million reads per second with p99 under 5 milliseconds, hold about 1 terabyte of data, and survive node failures."

Dịch: Thiết kế cache phân tán trong bộ nhớ kiểu Memcached hoặc Redis cluster: 1 triệu lượt đọc mỗi giây, p99 dưới 5 ms, chứa khoảng 1 TB dữ liệu, chịu được node chết. Thời gian 45 phút.

Đề này hay bị xem nhẹ vì "cache thì có gì mà thiết kế", nhưng nó gom gần hết Giai đoạn 2 vào một bài: phân mảnh (B3), replication (B2), nhất quán (B5), hot key (F7), failover (B6). Nó cũng là đề mà người phỏng vấn dễ đào sâu vô tận, nên quản lý thời gian là một phần của điểm.

## 1. Làm rõ yêu cầu (5 phút)
- Hỏi: Cache đặt trước cái gì? → Đáp: trước một lớp DB và một vài API nội bộ; đây là cache dùng chung cho nhiều dịch vụ.
- Hỏi: Mất dữ liệu cache có chấp nhận được không? → Đáp: **có**, cache là dữ liệu phái sinh; nhưng mất toàn bộ cùng lúc thì DB sập, nên phải tránh mất đồng loạt.
- Hỏi: Giá trị lớn cỡ nào? → Đáp: phần lớn dưới 10 KB, một số tới 1 MB.
- Hỏi: Cần thao tác gì ngoài get/set? → Đáp: get, set có TTL, delete, tăng số đếm; không cần transaction.
- Hỏi: Có cần bền vững (persistence) không? → Đáp: không bắt buộc, nhưng khởi động lại mà trống rỗng là vấn đề vận hành.
- Hỏi: Nhất quán với nguồn dữ liệu? → Đáp: eventual, chấp nhận dữ liệu cũ trong khoảng TTL.
- Hỏi: Đa tenant / cách ly? → Đáp: nhiều dịch vụ dùng chung, cần tránh một dịch vụ chiếm hết bộ nhớ.

Chốt lại: **Functional** get/set/delete/incr, TTL, thống kê. **Non-functional** 1M đọc/s, p99 < 5 ms, 1 TB, chịu mất node không mất dịch vụ, không gây sập DB khi cache lạnh. **Ngoài phạm vi**: truy vấn phức tạp, giao dịch, bền vững tuyệt đối.

## 2. Ước lượng (5 phút)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Dữ liệu | đề cho | 1 TB |
| RAM mỗi node | máy 64 GB, dành 48 GB cho dữ liệu | ~21 node cho 1 bản sao |
| Có replica 1:1 | ×2 | **~42 node** (làm tròn 48 cho dư địa) |
| QPS mỗi node | 1 triệu / 21 shard chính | ~48k lượt/s mỗi node — nằm trong khả năng (Redis một luồng đạt ~80–100k op/s) |
| Băng thông | 1 triệu × 2 KB trung bình | **2 GB/s** toàn hệ ≈ 100 MB/s mỗi node — đáng kể, phải nhắc NIC |
| Kích thước mục trung bình | 1 TB / giả định 500 triệu khoá | 2 KB |
| Chi phí một lần miss | DB 10 ms vs cache 0,5 ms | miss đắt gấp 20 lần → hit rate là chỉ số sống còn |

Con số đáng nói nhất: với hit rate 95%, 1 triệu đọc/s đẩy **50 000 request/s** xuống DB. Nếu hit rate tụt còn 90% thì DB nhận gấp đôi. **Cache không phải tối ưu nhỏ, nó là thứ giữ cho DB sống** — câu này nên nói sớm.

## 3. Thiết kế tổng thể (10–12 phút)
:::diagram
APP[App server + client lib] -> RING[Consistent hashing ring trong client]
RING -> N1[Node 1 primary]
RING -> N2[Node 2 primary]
RING -> N3[Node N primary]
N1 -- R1[Replica 1] : replicate bất đồng bộ
N2 -- R2[Replica 2]
CFG[Config service / cluster bus] -> APP : topology, epoch
CFG -> N1
MON[Giám sát: hit rate, evict, latency] -> N1
APP -> DB[(Database)] : khi miss
:::

**Quyết định kiến trúc số một: định tuyến ở đâu.**
| Cách | Mô tả | Ưu | Nhược |
|---|---|---|---|
| **Client-side (Memcached, Redis cluster)** | Thư viện client giữ bảng topology, tự băm khoá và nối thẳng tới node | Không thêm chặng mạng, p99 thấp nhất | Mọi client phải đồng bộ topology; nâng cấp client khó |
| Proxy (twemproxy, envoy) | Client nối tới proxy, proxy định tuyến | Client ngu, đổi topology dễ | Thêm 1 chặng (~0,3–1 ms) và một thứ phải scale |
| Router trong node (gossip) | Node nhận request sai thì chuyển tiếp hoặc trả MOVED | Cân bằng, Redis cluster dùng cách này | Phức tạp hơn, vẫn cần client hiểu MOVED |

Với p99 5 ms và 1 triệu QPS thì **client-side định tuyến** là lựa chọn mặc định; nêu proxy như phương án khi đội có nhiều ngôn ngữ client khác nhau.

**Phân mảnh**: consistent hashing với **150–200 virtual node mỗi node vật lý** để phân bố đều và để thêm/bớt node chỉ xáo trộn 1/N khoá. Giải thích ngắn vì sao không dùng [[hash(key) mod N]]: đổi N là xáo trộn gần như toàn bộ khoá, cache lạnh toàn hệ, DB chết — đây là câu trả lời mà người phỏng vấn chờ nghe.

## 4. Đào sâu (15–18 phút)
### 4.1 Eviction: LRU, LFU, TTL, và vì sao gần đúng là đủ
Bộ nhớ đầy thì phải bỏ ai đó. LRU đúng tuyệt đối cần danh sách liên kết cập nhật mỗi lần đọc — tốn CPU và khoá. Thực tế dùng **LRU gần đúng**: lấy mẫu ngẫu nhiên vài chục khoá, bỏ khoá cũ nhất trong mẫu (Redis làm vậy). **LFU** tốt hơn khi có nhóm khoá nóng ổn định và một luồng khoá dùng một lần quét qua (scan làm trôi LRU). Memcached dùng **slab allocation** để tránh phân mảnh: hệ quả thực tế là một slab class đầy vẫn evict dù tổng bộ nhớ còn trống — nêu được chi tiết này là dấu hiệu đã dùng thật.

### 4.2 Hot key: bài toán thực sự khó
Một khoá nóng (bài viết viral, cấu hình toàn cục) làm một shard nhận hết tải trong khi 20 shard khác rảnh. Bốn cách, nên nêu theo thứ tự:
1. **Cache cục bộ trong process** (L1) với TTL rất ngắn 1–5 s cho nhóm khoá nóng — giảm 90% lượt đi mạng, đổi lại dữ liệu cũ vài giây.
2. **Nhân bản khoá**: lưu [[key#1..key#N]], client chọn ngẫu nhiên; ghi thì ghi hết N bản.
3. **Đọc từ replica** cho khoá nóng.
4. **Phát hiện tự động**: đếm tần suất bằng count-min sketch ở client hoặc node, tự bật L1 cho khoá vượt ngưỡng.

### 4.3 Thundering herd / cache stampede
Khoá nóng hết hạn → nghìn request cùng miss cùng lúc → DB lãnh đủ. Ba lớp phòng thủ: **mutex/single-flight** (một request đi lấy, số còn lại chờ), **làm mới sớm theo xác suất** (xác suất làm mới tăng dần khi gần hết TTL), và **TTL có jitter** để không hết hạn đồng loạt. Jitter cũng là cách tránh thảm hoạ "mọi khoá sinh ra cùng lúc lúc deploy".

### 4.4 Replication và failover
Replica bất đồng bộ là đủ cho cache: mất vài giây dữ liệu cache không sao. Khi primary chết: cluster bus phát hiện qua gossip, đa số node đồng ý node đó chết, promote replica, **tăng epoch** và phát topology mới (đây là fencing của B6 ở dạng nhẹ). Client thấy epoch mới thì cập nhật bảng. Nói rõ: **chấp nhận mất khoá, không chấp nhận split-brain** vì hai primary cùng nhận ghi làm dữ liệu cache mâu thuẫn và sinh lỗi khó lần hơn nhiều.

### 4.5 Cache lạnh và khởi động lại
Khởi động lại một node = mất 48 GB cache = tăng đột ngột tải DB. Giảm đau bằng: rolling restart từng node (không bao giờ đồng loạt), **warm-up** bằng cách đọc replica hoặc replay traffic mẫu, và **rate limit phía DB** để cache miss không kéo sập nguồn. Redis có RDB/AOF: với vai trò cache thuần thì tắt để khỏi tốn I/O, nhưng nếu khởi động lại thường xuyên thì bật RDB là đánh đổi hợp lý.

### 4.6 Nhất quán với nguồn
Cache-aside là mặc định; ghi thì **xoá khoá, không ghi đè** (ghi đè dễ tạo dữ liệu cũ do đua giữa hai luồng). Kể cả vậy vẫn có cửa sổ đua kinh điển: A đọc miss, lấy giá trị cũ từ DB; B ghi DB rồi xoá cache; A ghi giá trị cũ vào cache → cache giữ dữ liệu cũ tới hết TTL. Cách giảm: TTL ngắn, hoặc xoá hai lần có độ trễ (delayed double delete), hoặc dùng version/CAS. Nói rằng "không có cách rẻ nào đạt nhất quán tuyệt đối giữa cache và DB, nên tôi chọn TTL ngắn và chấp nhận" là câu trả lời trưởng thành.

### 4.7 Đa tenant và bảo vệ
Namespace theo prefix, hạn mức bộ nhớ và hạn mức băng thông theo namespace, chặn giá trị quá lớn (trên 1 MB), cấm lệnh quét toàn bộ ([[KEYS]]) trên production. Số phải giám sát: hit rate theo namespace, số evict/s, độ trễ p99 theo node, bộ nhớ dùng, số khoá nóng phát hiện được.

## 5. Trade-off & câu hỏi vặn (5 phút)
- **Memcached vs Redis**: Memcached đơn giản, đa luồng, thuần cache; Redis có cấu trúc dữ liệu, replication, cluster, Lua. Nếu chỉ cần get/set khối lượng lớn thì Memcached vẫn là lựa chọn gọn và rẻ hơn.
- **Cache riêng vs cache nhúng**: nhúng trong process thì nhanh nhất, nhưng mỗi process một bản, tốn RAM và khó vô hiệu hoá; thực tế dùng **cả hai tầng** (L1 nhỏ trong process + L2 phân tán).
- **Cache có nên bền vững không**: vai trò khác nhau; nếu bạn bắt đầu cần đảm bảo không mất thì bạn đang xây database, hãy nói thẳng ra.

### Sai lầm hay gặp
- Dùng modulo thay vì consistent hashing rồi không giải thích được chuyện thêm node.
- Quên hot key, trong khi đây là câu vặn chắc chắn có.
- Nói "cache đảm bảo nhất quán" — không, nó đổi tính đúng lấy tốc độ trong giới hạn TTL.
- Bỏ qua stampede và cold start, hai nguyên nhân phổ biến nhất khiến DB sập vì cache.
- Đặt TTL cố định cho mọi khoá, không jitter.
- Thiết kế failover tự động mà không có epoch/fencing.
- Không nhắc tới băng thông mạng dù 1 triệu × 2 KB là 2 GB/s.

## 6. Người phỏng vấn chấm gì
Consistent hashing giải thích được bằng một câu; tính được số node từ RAM; nói được client-side routing và vì sao; xử lý hot key có nhiều hơn một cách; stampede và cold start có phương án; nhất quán cache–DB nói đúng bản chất là đánh đổi chứ không hứa suông.

### Nói thế nào trong phỏng vấn (EN)
- "Modulo hashing reshuffles nearly every key when the node count changes, which means a cold cache and a dead database; consistent hashing with virtual nodes only moves one over N." — Lý do dùng consistent hashing.
- "A cache is derived data: losing a node is acceptable, losing all of it at once is an outage of the database behind it." — Phân biệt mất một phần và mất toàn bộ.
- "For a hot key I would add a very short-lived in-process L1 cache and optionally replicate the key across several slots." — Hai cách xử lý hot key.
- "I invalidate by deleting the key rather than writing through, and I accept a small staleness window rather than pretending cache and database can be kept perfectly consistent." — Nói đúng bản chất.
- "Restarts are rolling, never simultaneous, and TTLs carry jitter so that keys do not all expire in the same second." — Vận hành.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Redis của bạn đang làm ba việc khác nhau: cache enrichment (tra license/vuln theo coordinate), rate limiter cho API ngoài, và cache kết quả truy vấn nặng. Ba việc có yêu cầu khác nhau — mất cache enrichment chỉ tốn tiền gọi lại API, mất rate limiter là **vượt hạn mức của nhà cung cấp** và bị chặn. Tách namespace, tách hạn mức bộ nhớ, và ghi rõ hậu quả mất mát của từng nhóm trong ADR.
- Hot key có thật trong miền của bạn: các component phổ biến (lodash, log4j, openssl) nằm trong SBOM của gần như mọi tenant, nên khoá cache theo coordinate sẽ nóng bất thường. Đây đúng là tình huống **L1 trong process TTL 60 s** — dữ liệu license/CVE gần như bất biến nên cũ vài phút không sao, mà giảm hẳn lượt đi Redis.
- Stampede: khi sweeper và scheduled scan chạy cùng lúc, hàng nghìn coordinate cùng miss và cùng gọi ClearlyDefined/OSV. Single-flight theo coordinate (một goroutine đi lấy, các goroutine khác chờ kết quả) là lab L3 bạn đã làm — chuyển thẳng vào enrichment coordinator.
- TTL phải có jitter: nếu toàn bộ cache enrichment được nạp trong một lần scan lớn với TTL 24 giờ thì đúng 24 giờ sau cả khối cùng hết hạn và tái diễn đợt gọi API ồ ạt. Thêm jitter ±10%.
- Khởi động lại Redis hiện làm cache trống hoàn toàn và đẩy tải thẳng sang API ngoài có rate limit — rủi ro lớn hơn trường hợp cache trước DB, vì nguồn ngoài sẽ chặn bạn chứ không chỉ chậm. Hoặc bật RDB để ấm lại nhanh, hoặc đảm bảo rate limiter khởi động với trạng thái bảo thủ.
- Nhất quán cache–DB áp vào chỗ cụ thể: khi tenant ghi đè license (overlay), phải **xoá** khoá cache của component đó cho tenant đó, không ghi đè; và nhớ rằng khoá cache cho dữ liệu overlay **bắt buộc có tenant_id**, nếu không bạn lặp lại sự cố #15 ở tầng cache.
- Việc thứ Sáu: thêm bốn metric vào dashboard — hit rate theo namespace, số evict/s, bộ nhớ dùng, và p99 lệnh Redis. Không có hit rate thì mọi tranh luận về cache sau này đều là cảm tính.
`,
  quiz: [
    { t: 'mc', q: '1 TB dữ liệu, máy 64 GB dành 48 GB cho dữ liệu, có một replica cho mỗi shard. Số node xấp xỉ?', o: ['21 node', '42 node', '16 node', '84 node'], a: 1, why: '1 TB / 48 GB ≈ 21 shard chính, nhân 2 cho replica ≈ 42 node (thực tế lấy dư thành 48).' },
    { t: 'mc', q: 'Vì sao không dùng hash(key) mod N để chọn node?', o: ['Vì hàm hash không đủ nhanh', 'Vì khi N đổi thì gần như toàn bộ khoá ánh xạ sang node khác, cache lạnh toàn hệ và DB nhận đủ tải', 'Vì modulo gây đụng độ khoá', 'Vì không phân bố đều được'], a: 1, why: 'Consistent hashing chỉ xáo trộn khoảng 1/N khoá khi thêm hoặc bớt một node.' },
    { t: 'mc', q: 'Một khoá nóng chiếm 40% lưu lượng, dồn hết vào một shard. Phương án hiệu quả nhất và rẻ nhất để thử trước?', o: ['Tăng số node trong cluster', 'Chuyển sang LFU', 'Thêm cache L1 trong process với TTL ngắn 1-5 giây cho nhóm khoá nóng', 'Tăng kích thước RAM của shard đó'], a: 2, why: 'Thêm node không giúp vì khoá vẫn băm về một shard; L1 cắt phần lớn lượt đi mạng với cái giá là dữ liệu cũ vài giây.' },
    { t: 'mc', q: 'Chiến lược vô hiệu hoá nào an toàn hơn khi dữ liệu nguồn thay đổi?', o: ['Ghi đè khoá cache bằng giá trị mới ngay sau khi ghi DB', 'Xoá khoá cache và để lần đọc sau nạp lại', 'Giữ nguyên và chờ TTL', 'Xoá toàn bộ namespace cho chắc'], a: 1, why: 'Ghi đè dễ tạo dữ liệu cũ khi hai luồng ghi đua nhau; xoá rồi nạp lại ít cửa sổ sai hơn, dù vẫn còn cửa sổ đua đọc-ghi.' },
    { t: 'mc', q: 'Primary của một shard chết, cluster promote replica. Thứ bắt buộc phải có để tránh hỏng dữ liệu là gì?', o: ['Replication đồng bộ', 'Tăng epoch và phát topology mới để primary cũ không còn được nhận ghi (fencing)', 'Bật AOF trên mọi node', 'Chuyển sang proxy routing'], a: 1, why: 'Không có epoch/fencing thì primary cũ sống lại vẫn nhận ghi, sinh split-brain với dữ liệu cache mâu thuẫn.' },
    { t: 'fill', q: 'Điền: hiện tượng một khoá nóng hết hạn làm hàng nghìn request cùng miss và cùng gọi xuống DB gọi là cache ___.', a: ['stampede', 'cache stampede', 'thundering herd'], why: 'Chữa bằng single-flight, làm mới sớm theo xác suất, và TTL có jitter.' },
    { t: 'fill', q: 'Điền: kỹ thuật gán mỗi node vật lý nhiều điểm trên vòng băm để phân bố đều và giảm xáo trộn khi thay đổi cụm gọi là ___ node.', a: ['virtual', 'vnode', 'virtual node'], why: 'Thường 150-200 virtual node mỗi node vật lý; thiếu nó thì phân bố lệch và việc bớt node dồn tải vào đúng một hàng xóm.' },
    { t: 'open', q: 'Người phỏng vấn vặn: "Cả cụm cache vừa restart, hit rate về 0, database đang 100% CPU và request bắt đầu timeout. Bạn làm gì trong 10 phút tới và sửa gốc thế nào?"', a: 'Trong 10 phút đầu là giảm tải chứ không phải sửa: bật load shedding ở tầng API trả 503 nhanh cho traffic ít giá trị, bật rate limit phía truy cập DB để cache miss không vượt quá khả năng, tạm tăng TTL và bật single-flight để nhiều request cùng khoá chỉ đi một lượt xuống DB, nếu có replica đọc thì chuyển truy vấn đọc sang đó, và nếu có thể thì khôi phục dần từng phần traffic thay vì mở hết. Sau khi ổn định, sửa gốc theo bốn hướng. Một là không bao giờ restart đồng loạt: rolling restart từng node và giới hạn số node ngoài vòng cùng lúc. Hai là làm ấm cache: bật RDB hoặc warm-up bằng cách replay một tập khoá nóng khi node lên, có thể đọc từ replica còn sống. Ba là bảo vệ nguồn: single-flight theo khoá, hàng đợi có giới hạn phía DB, circuit breaker để miss không biến thành bão. Bốn là TTL có jitter để tránh hết hạn đồng loạt, và đặt alert trên hit rate giảm đột ngột để lần sau biết trước khi DB kêu. Cuối cùng viết postmortem ghi rõ hit rate trước và sau, thời gian ấm lại, và đưa bài kiểm tra cold start vào game day định kỳ.', keys: ['load shedding', 'single-flight', 'rolling restart', 'warm-up', 'jitter'] }
  ]
},

{ id: 'C22', type: 'case', topic: 'data', title: 'Case: Design a trending / top-K system (heavy hitters)', time: '90 phút',
  goal: 'Thiết kế hệ đếm top-K thời gian thực trên luồng sự kiện lớn: vì sao đếm chính xác không khả thi, dùng count-min sketch và heap thế nào, cửa sổ trượt, kết hợp lớp nhanh và lớp chính xác, và chống gian lận.',
  md: `
## Đề bài
> "Design a system that shows the top 100 trending search terms in the last hour, the last day and the last week, over a stream of 500 thousand searches per second. The list should update within a minute."

Dịch: Thiết kế hệ hiển thị 100 từ khoá tìm kiếm thịnh hành nhất trong 1 giờ, 1 ngày và 7 ngày qua, trên luồng 500 nghìn lượt tìm kiếm mỗi giây, cập nhật trong vòng 1 phút. Thời gian 45 phút.

Đây là biến thể của bài "heavy hitters" kinh điển và rất hay gặp vì nó buộc ứng viên phải thừa nhận một điều: **ở quy mô này, đếm chính xác mọi thứ là lựa chọn sai**. Ai nói ngay "tôi sẽ dùng một bảng đếm trong Redis cho mỗi từ khoá" thì đã rơi vào bẫy. Nền tảng ở B13 (stream, window, watermark) và B10 (thời gian, thứ tự).

## 1. Làm rõ yêu cầu (5 phút)
- Hỏi: Top-K có cần chính xác tuyệt đối không? → Đáp: **không**; sai một vài vị trí ở cuối bảng là chấp nhận được, nhưng mục trong top 10 phải đúng.
- Hỏi: Độ trễ cập nhật? → Đáp: 1 phút cho giờ, 5 phút cho ngày và tuần.
- Hỏi: Số từ khoá riêng biệt? → Đáp: khoảng 1 tỉ chuỗi khác nhau mỗi ngày, phần lớn chỉ xuất hiện một lần.
- Hỏi: Cần chia theo quốc gia/ngôn ngữ không? → Đáp: có, khoảng 50 phân vùng.
- Hỏi: Có cần chống spam/bot không? → Đáp: có, đây là bảng công khai nên sẽ bị cố tình đẩy.
- Hỏi: Lịch sử có cần truy vấn lại không? → Đáp: cần xem top của một ngày trong quá khứ.
- Hỏi: Sự kiện có đến muộn không? → Đáp: có, mobile offline có thể gửi muộn tới vài giờ.

Chốt: **Functional** top-K theo ba cửa sổ × 50 phân vùng, truy vấn lịch sử, lọc gian lận. **Non-functional** 500k sự kiện/s, cập nhật dưới 1 phút, sai số chấp nhận được ở đuôi bảng, chi phí hợp lý. **Ngoài phạm vi**: gợi ý cá nhân hoá, autocomplete (đó là C8).

## 2. Ước lượng (5 phút)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Sự kiện | đề cho | 500k/s = 43 tỉ/ngày |
| Băng thông sự kiện | 500k × 100 byte | 50 MB/s = 4,3 TB/ngày thô |
| Từ khoá riêng biệt/ngày | đề cho | ~1 tỉ |
| Nếu đếm chính xác trong RAM | 1 tỉ × (32 byte chuỗi + 8 byte đếm + overhead ~50 byte) | **~90 GB mỗi cửa sổ mỗi phân vùng** — không khả thi |
| Count-min sketch | 4 hàm băm × 2^20 ô × 4 byte | **16 MB** cho sai số ~0,1% của tổng |
| Sketch × 50 phân vùng × 3 cửa sổ | 16 MB × 150 | 2,4 GB — vừa RAM một máy |
| Heap top-K | 100 mục × 50 × 3 | không đáng kể |

Đây là bài mà **ước lượng chính là lời giải**: đặt 90 GB cạnh 16 MB là bạn đã chứng minh vì sao cần cấu trúc xấp xỉ, và người phỏng vấn gần như chỉ chờ con số đó.

## 3. Thiết kế tổng thể (10–12 phút)
:::diagram
SRC[Web + mobile] -> GW[Ingest gateway]
GW -> K[Kafka: partition theo hash(term)]
K -> AGG[Stream aggregator: CMS + heap theo cửa sổ]
AGG -> RS[Redis: top-K hiện hành theo partition+window]
AGG -> RAW[Object storage: sự kiện thô theo giờ]
RAW -> BATCH[Batch job hằng giờ: đếm chính xác]
BATCH -> DW[(Kho số liệu: top-K chuẩn theo giờ/ngày)]
API[Top-K API] -> RS : đọc nóng
API -> DW : đọc lịch sử
FR[Lọc gian lận: ngưỡng theo user/IP] -> AGG
:::

**Kiến trúc hai lớp (lambda) là lựa chọn đúng ở đây và phải nói rõ vì sao**: lớp nhanh (stream + sketch) cho con số gần đúng trong vài giây; lớp chính xác (batch trên dữ liệu thô) chạy mỗi giờ, ghi đè kết quả và phục vụ truy vấn lịch sử. Lớp batch cũng là nơi xử lý **sự kiện đến muộn** — thứ mà lớp stream không xử lý tốt. Nếu người phỏng vấn muốn kiến trúc gọn hơn, nêu phương án kappa: chỉ một đường stream, chạy lại từ Kafka khi cần sửa.

**Phân mảnh**: partition Kafka theo [[hash(term)]] để mọi sự kiện của cùng một từ khoá về cùng một aggregator → cộng cục bộ không cần phối hợp. Mỗi aggregator giữ sketch riêng; khi cần kết quả toàn cục thì **hợp nhất** (count-min sketch cộng được từng ô, đây là tính chất khiến nó dùng được ở hệ phân tán).

## 4. Đào sâu (15–18 phút)
### 4.1 Count-min sketch: cách hoạt động và sai số
Mảng 2 chiều d hàng × w cột, d hàm băm độc lập. Đếm: với mỗi hàng i, tăng ô [i][h_i(term)]. Đọc: lấy **giá trị nhỏ nhất** trong d ô. Vì đụng độ chỉ làm số **tăng**, giá trị nhỏ nhất là ước lượng trên và **không bao giờ nhỏ hơn số thật**. Sai số: với w = e/epsilon và d = ln(1/delta), sai số không quá epsilon × tổng số sự kiện với xác suất 1 - delta. Hệ quả thực tế phải nói: **sketch rất chính xác với mục nóng và rất tệ với mục hiếm** — may mắn thay bài toán top-K chỉ quan tâm mục nóng.
- Giữ top-K: một **min-heap 100 phần tử**; mỗi lần cập nhật, nếu ước lượng của term lớn hơn đỉnh nhỏ nhất của heap thì đẩy vào. Kèm một bảng băm nhỏ để biết term nào đang trong heap.
- Cần cả **số lượng mục riêng biệt**? Dùng HyperLogLog: 12 KB cho sai số ~2% trên hàng tỉ mục.
- Muốn chính xác hơn cho mục nóng? **Space-Saving / Misra-Gries** giữ đúng K mục kèm bộ đếm và cho cận trên cận dưới; tốt hơn CMS khi chỉ cần top-K, còn CMS tốt khi cần tra số đếm của một mục bất kỳ.

### 4.2 Cửa sổ thời gian: đừng xoá, hãy xoay
Cửa sổ trượt chính xác tốn bộ nhớ. Cách thực dụng: **cửa sổ nhảy gồm nhiều bucket nhỏ** — ví dụ cửa sổ 1 giờ = 60 sketch theo phút. Mỗi phút tạo sketch mới, bỏ sketch cũ nhất, kết quả giờ là tổng 60 sketch (cộng được nên rất rẻ). Cửa sổ ngày = 24 sketch theo giờ; tuần = 7 sketch theo ngày. Chi phí cố định, độ chi tiết rõ ràng, giải thích được trong 30 giây.
- Thay thế khi muốn "nóng gần đây quan trọng hơn": **đếm có suy giảm theo hàm mũ** — nhân toàn bộ sketch với 0,95 mỗi phút thay vì xoá bucket. Mượt hơn, nhưng khó giải thích "trong 1 giờ qua" một cách chính xác.

### 4.3 Trending không phải là top count
Một chi tiết hay được hỏi vặn: "Facebook" luôn đứng đầu mọi bảng đếm — nhưng nó không **trending**. Trending là **độ bất thường**, không phải độ lớn: so số đếm cửa sổ hiện tại với **đường cơ sở** (trung bình cùng khung giờ 7 ngày trước), tính z-score hoặc tỉ lệ tăng, và yêu cầu ngưỡng tối thiểu để tránh mục rất hiếm nhảy vọt về tỉ lệ. Nêu được phân biệt này là điểm cao rõ rệt.

### 4.4 Chống gian lận
Bảng công khai luôn bị đẩy. Lớp phòng thủ: đếm theo **số người dùng riêng biệt** (HLL mỗi term) thay vì số lượt, nên một bot bấm 1 triệu lần vẫn chỉ là một người; giới hạn đóng góp mỗi user/IP mỗi phút; loại traffic không có phiên hợp lệ; so lệch giữa lớp stream và lớp batch để phát hiện bất thường; và giữ một **danh sách chặn** cùng quy trình người duyệt cho top 10 ở sản phẩm nhạy cảm.

### 4.5 Phục vụ và cập nhật
Kết quả cuối rất nhỏ (100 mục × 150 bảng) → đẩy vào Redis, API đọc với p99 vài ms, CDN cache 30 giây. Cập nhật theo kiểu **ghi phiên bản mới rồi đổi con trỏ**, không sửa tại chỗ, để người đọc không thấy bảng nửa vời. Đây đúng là mẫu generation swap đã dùng cho dữ liệu phái sinh ở các bài trước.

### 4.6 Đúng đắn khi hệ hỏng
Aggregator chết: Kafka consumer group gán lại partition, state (sketch) phải được **checkpoint** định kỳ, nếu không phải chạy lại từ đầu cửa sổ. Dùng Flink/Kafka Streams thì có state backend sẵn; tự viết thì checkpoint sketch vào object storage mỗi phút — sketch nén tốt và nhỏ nên rẻ. Đếm trùng khi replay: với top-K thì sai số nhỏ chấp nhận được, nói rõ "tôi chọn at-least-once vì vài phần nghìn sai số không đổi thứ hạng".

## 5. Trade-off & câu hỏi vặn (5 phút)
- **Xấp xỉ vs chính xác**: xấp xỉ cho lớp nhanh, chính xác cho lịch sử và báo cáo. Đừng cố chọn một.
- **CMS vs Space-Saving**: CMS cộng được (hợp nhất giữa node dễ) và tra được mọi term; Space-Saving tiết kiệm hơn khi chỉ cần top-K. Nói được tiêu chí chọn là đủ.
- **Lambda vs kappa**: lambda có hai đường code dễ lệch logic; kappa gọn hơn nhưng chạy lại lịch sử tốn thời gian. Với yêu cầu "xem top ngày trong quá khứ", lambda hợp lý hơn.

### Sai lầm hay gặp
- Đề xuất Redis INCR cho mỗi từ khoá mà không tính ra 1 tỉ khoá.
- Không phân biệt "nhiều nhất" và "đang tăng".
- Dùng cửa sổ trượt chính xác rồi vỡ bộ nhớ.
- Quên hợp nhất sketch giữa các node.
- Quên chống gian lận trong khi đề nói bảng là công khai.
- Không nói gì về sự kiện đến muộn.
- Quên checkpoint state nên aggregator restart là mất cửa sổ.

## 6. Người phỏng vấn chấm gì
Tính ra được chi phí của đếm chính xác rồi bác bỏ nó bằng số; mô tả CMS đúng (lấy min, chỉ ước lượng thừa); dùng bucket để làm cửa sổ; tách trending khỏi top count; có lớp batch cho chính xác và sự kiện muộn; có chống gian lận; quản lý state khi node chết.

### Nói thế nào trong phỏng vấn (EN)
- "Counting a billion distinct terms exactly would need around ninety gigabytes per window; a count-min sketch gives me the same top-K answer in sixteen megabytes." — Số liệu bác bỏ phương án ngây thơ.
- "The sketch only ever overestimates, so I take the minimum across rows, and the error is proportional to total traffic — which means it is accurate exactly where I need it, on the heavy hitters." — Hiểu đúng sai số.
- "I build the hour window from sixty one-minute sketches and simply add them, because sketches are mergeable." — Cửa sổ bằng bucket.
- "Most-searched is not the same as trending: I compare the current window against a seven-day baseline for the same hour and rank by deviation." — Phân biệt quan trọng nhất của bài.
- "Counting distinct users per term with HyperLogLog instead of raw events removes most of the bot amplification for free." — Chống gian lận bằng cấu trúc dữ liệu.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Bài này trả lời một câu hỏi sản phẩm bạn đang thiếu: **"CVE nào đang lan nhanh nhất trong danh mục của tôi tuần này"** và **"license rủi ro nào xuất hiện nhiều nhất"**. Đó là dashboard mà khách hàng bảo mật muốn thấy, và nó là bài top-K trên luồng sự kiện component.
- Quy mô của bạn nhỏ hơn đề nhiều: 50 triệu dòng liên kết (target, component) và vài nghìn upload/ngày, nên **không cần sketch**. Đây là điểm quan trọng để nói trong phỏng vấn: biết công cụ nhưng chọn đúng mức — một bảng tổng hợp [[component_count_by_tenant_by_day]] cập nhật incremental khi upload là đủ, và chính xác.
- Thứ **nên** mượn nguyên vẹn là phân biệt trending và top count: component phổ biến nhất luôn là lodash hay openssl, nhưng thứ đáng báo động là CVE mới xuất hiện trong 200 target trong 24 giờ khi hôm qua chưa có. Dùng đường cơ sở 7 ngày và xếp hạng theo độ lệch, đúng như mục 4.3.
- Mẫu generation swap ở mục 4.5 là **đúng cách chữa sự cố #14**: bảng xếp hạng (và bảng violation) là dữ liệu phái sinh, nên tính ra bản mới rồi đổi con trỏ trong một transaction, không bao giờ sửa tại chỗ hay xoá rồi ghi lại. Nếu lần tính mới lỗi thì bản cũ vẫn phục vụ.
- Bucket theo giờ áp cho thống kê quét: giữ 24 bucket giờ và 7 bucket ngày cho mỗi tenant thay vì quét lại bảng 9,6 triệu dòng mỗi lần mở dashboard (đúng chỗ đã gây sự cố #6: seq scan liên tục làm CPU 100%).
- HyperLogLog có một chỗ dùng thật và rẻ: đếm **số component riêng biệt** và **số target bị ảnh hưởng** cho mỗi CVE trên toàn hệ mà không phải COUNT DISTINCT trên bảng lớn; Redis có sẵn lệnh, sai số 2% là thừa đủ cho một con số hiển thị.
- Việc thứ Sáu: viết query tính top 20 CVE theo số target bị ảnh hưởng trong 7 ngày, đo thời gian chạy, rồi quyết định có cần bảng tổng hợp incremental không. Ghi số đo vào Sổ tay — quyết định dựa trên số, không dựa trên cảm giác chậm.
`,
  quiz: [
    { t: 'mc', q: 'Vì sao đếm chính xác mọi từ khoá trong RAM không khả thi ở đề này?', o: ['Vì Redis không chịu được 500k lệnh mỗi giây', 'Vì 1 tỉ từ khoá riêng biệt mỗi ngày cần khoảng 90 GB mỗi cửa sổ mỗi phân vùng, nhân lên 150 bảng là không kinh tế', 'Vì không có cách phân mảnh theo từ khoá', 'Vì hash của chuỗi quá chậm'], a: 1, why: 'Đặt 90 GB cạnh 16 MB của count-min sketch chính là lập luận mà người phỏng vấn chờ nghe.' },
    { t: 'mc', q: 'Count-min sketch trả về ước lượng bằng cách nào và sai lệch theo hướng nào?', o: ['Trung bình các ô, sai lệch hai chiều', 'Giá trị nhỏ nhất trong các ô tương ứng; chỉ có thể ước lượng thừa, không bao giờ thiếu', 'Giá trị lớn nhất; chỉ ước lượng thiếu', 'Tổng các ô chia cho số hàm băm'], a: 1, why: 'Đụng độ chỉ làm ô tăng, nên min là cận trên gần nhất; sai số tỉ lệ với tổng lưu lượng nên mục nóng được ước lượng rất sát.' },
    { t: 'mc', q: 'Cách dựng cửa sổ 1 giờ nào vừa rẻ vừa dễ giải thích?', o: ['Giữ danh sách timestamp của mọi sự kiện và lọc theo thời gian', 'Giữ 60 sketch theo phút và cộng lại khi truy vấn, mỗi phút bỏ sketch cũ nhất', 'Xoá toàn bộ sketch mỗi giờ', 'Nhân sketch với 0,5 mỗi phút'], a: 1, why: 'Sketch cộng được nên cửa sổ nhảy theo bucket cho chi phí cố định và ngữ nghĩa rõ ràng.' },
    { t: 'mc', q: 'Một từ khoá luôn có lượng tìm kiếm cao nhất nhưng không nên nằm trong bảng trending. Cách xếp hạng đúng?', o: ['Chỉ lấy số đếm tuyệt đối trong cửa sổ', 'So số đếm cửa sổ hiện tại với đường cơ sở cùng khung giờ 7 ngày trước và xếp theo độ lệch, kèm ngưỡng tối thiểu', 'Loại bỏ thủ công các từ khoá phổ biến', 'Chia số đếm cho độ dài chuỗi'], a: 1, why: 'Trending là độ bất thường chứ không phải độ lớn; ngưỡng tối thiểu để mục rất hiếm không nhảy vọt theo tỉ lệ.' },
    { t: 'mc', q: 'Biện pháp chống bot hiệu quả nhất mà gần như miễn phí về hạ tầng?', o: ['Chặn IP theo danh sách', 'Đếm số người dùng riêng biệt cho mỗi từ khoá bằng HyperLogLog thay vì đếm số lượt', 'Tăng cửa sổ lên 24 giờ', 'Yêu cầu đăng nhập mới được tìm kiếm'], a: 1, why: 'Một bot bấm một triệu lần vẫn chỉ là một người riêng biệt; HLL tốn khoảng 12 KB mỗi term cho sai số 2%.' },
    { t: 'fill', q: 'Điền: cấu trúc dữ liệu xấp xỉ dùng khoảng 12 KB để ước lượng số phần tử riêng biệt trong tập hàng tỉ mục với sai số khoảng 2% gọi là ___.', a: ['HyperLogLog', 'HLL'], why: 'Dùng để đếm distinct user hoặc distinct item mà không giữ tập thật.' },
    { t: 'fill', q: 'Điền: lớp kiến trúc chạy batch trên dữ liệu thô để ghi đè kết quả gần đúng của lớp stream, đồng thời xử lý sự kiện đến muộn, là đặc trưng của kiến trúc ___.', a: ['lambda', 'lambda architecture'], why: 'Đối lập với kappa (chỉ một đường stream, chạy lại từ log khi cần sửa).' },
    { t: 'open', q: 'Người phỏng vấn vặn: "Một aggregator chết giữa cửa sổ. Chuyện gì xảy ra với bảng top-K và bạn thiết kế thế nào để không mất?"', a: 'Trạng thái của aggregator là sketch và heap trong bộ nhớ nên node chết là mất phần cửa sổ chưa ghi ra ngoài. Kafka sẽ gán lại partition đó cho một consumer khác trong cùng group, nhưng nếu không có checkpoint thì node mới phải đọc lại từ offset cũ và dựng lại trạng thái, tốn thời gian và có thể đếm trùng phần đã xử lý. Thiết kế đúng là checkpoint định kỳ: mỗi phút ghi sketch cùng offset tương ứng vào object storage hoặc state backend của Flink hay Kafka Streams; khi khôi phục thì nạp sketch gần nhất rồi replay từ đúng offset đã lưu, nên chỉ xử lý lại tối đa một phút. Sketch nén tốt và chỉ vài chục megabyte nên checkpoint rẻ. Về ngữ nghĩa tôi chấp nhận at-least-once và nói rõ vì sao: đếm trùng vài phần nghìn không đổi thứ hạng top 100, trong khi làm exactly-once cho đường stream đắt hơn giá trị nó mang lại. Phần chính xác tuyệt đối đã được lớp batch hằng giờ đảm nhiệm, nó đọc dữ liệu thô bất biến nên luôn hội tụ về số đúng và cũng là nơi nhặt lại sự kiện đến muộn. Trong lúc một partition đang khôi phục, API vẫn phục vụ bản top-K gần nhất đã publish vì tôi đổi con trỏ sang bản mới chứ không sửa tại chỗ.', keys: ['checkpoint', 'offset', 'at-least-once', 'batch', 'partition'] }
  ]
},

{ id: 'C23', type: 'case', topic: 'consistency', title: 'Case: Design a digital wallet with a double-entry ledger', time: '90 phút',
  goal: 'Thiết kế ví điện tử đúng về tiền: sổ cái bút toán kép, idempotency, chuyển tiền giữa hai ví, saga với dịch vụ ngoài, đối soát, và nói được vì sao không bao giờ lưu số dư như một con số có thể UPDATE tuỳ tiện.',
  md: `
## Đề bài
> "Design a digital wallet. Users can top up from a bank card, transfer money to another user instantly, pay merchants, and withdraw. Ten million users, 5 thousand transactions per second at peak. Money must never be lost or created."

Dịch: Thiết kế ví điện tử: nạp tiền từ thẻ, chuyển tiền cho người dùng khác tức thì, thanh toán cho merchant, rút tiền. 10 triệu người dùng, đỉnh 5 nghìn giao dịch mỗi giây. Tiền không được mất và không được tự sinh ra. Thời gian 45 phút.

Đây là đề "đúng đắn quan trọng hơn mọi thứ khác" — khác hẳn feed hay search. Người phỏng vấn chấm bạn ở một tiêu chí duy nhất trước tiên: **bạn có hiểu tại sao số dư không phải là một cột để UPDATE không**. C11 (payment system) nhìn từ phía luồng thanh toán; bài này nhìn từ phía **sổ sách**.

## 1. Làm rõ yêu cầu (5 phút)
- Hỏi: Một loại tiền tệ hay nhiều? → Đáp: bắt đầu một (VND), nhưng thiết kế đừng chặn đường đa tiền tệ.
- Hỏi: Chuyển tiền trong hệ có cần tức thì không? → Đáp: có, dưới 1 giây, và **nguyên tử**.
- Hỏi: Nạp/rút qua ngân hàng mất bao lâu? → Đáp: bất đồng bộ, vài giây tới vài ngày, có webhook trả kết quả, có thể thất bại sau khi đã nhận.
- Hỏi: Cho phép âm số dư không? → Đáp: **không**, trừ tài khoản hệ thống.
- Hỏi: Yêu cầu kiểm toán? → Đáp: phải tái dựng được số dư tại bất kỳ thời điểm nào và giải thích được từng đồng.
- Hỏi: Hoàn tiền, tranh chấp? → Đáp: có, có thể hoàn một phần.
- Hỏi: Hot account? → Đáp: có, ví merchant lớn nhận hàng nghìn giao dịch mỗi giây.

Chốt: **Functional** nạp, chuyển, thanh toán, rút, hoàn, xem lịch sử, đối soát. **Non-functional** không mất/không sinh tiền, idempotent trước retry, kiểm toán được, p99 chuyển tiền dưới 1 s, chịu được hot account. **Ngoài phạm vi**: KYC, chống rửa tiền, lãi suất, đa tiền tệ giai đoạn một.

## 2. Ước lượng (5 phút)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Giao dịch | 5k/s đỉnh, giả định 500/s trung bình | 43 triệu/ngày |
| Bút toán (entry) | mỗi giao dịch ít nhất 2 dòng | **86 triệu dòng/ngày** |
| Dung lượng | 86 triệu × 150 byte | ~13 GB/ngày, ~4,7 TB/năm |
| Ghi DB | 5k giao dịch/s × 2 entry + 1 transaction row | ~15k dòng/s lúc đỉnh |
| Số dư đọc | mỗi lần mở app | đọc nhiều hơn ghi 10:1 |
| Giữ nóng | 90 ngày gần nhất | ~1,2 TB, phần cũ chuyển sang lưu trữ lạnh |

Kết luận cần nói: **15k dòng ghi/s nằm trong tầm một Postgres được tune tốt** — đây không phải bài về quy mô, mà là bài về tính đúng. Nếu bạn vội đi shard thì bạn đang trả lời sai câu hỏi.

## 3. Thiết kế tổng thể (10–12 phút)
:::diagram
APP[App / merchant] -> API[Wallet API]
API -> IDEM[Bảng idempotency key]
API -> LED[Ledger service]
LED -> PG[(Postgres: accounts, entries, transactions)]
LED -> OUT[Outbox]
OUT -> MQ[Broker]
MQ -> NOTI[Notification]
MQ -> RPT[Báo cáo / kho số liệu]
API -> PSP[Cổng thanh toán / ngân hàng]
PSP -> WH[Webhook handler]
WH -> LED
REC[Job đối soát hằng ngày] -> PG
REC -> PSP : sao kê
:::

**Mô hình dữ liệu là phần quan trọng nhất của bài này:**
| Bảng | Khoá | Ghi chú |
|---|---|---|
| accounts | account_id | user_id, loại (user/merchant/system), currency, trạng thái |
| transactions | transaction_id | loại, trạng thái, idempotency_key duy nhất, metadata |
| **entries** | entry_id | transaction_id, account_id, **amount có dấu**, currency, created_at — **chỉ thêm, không sửa, không xoá** |
| balances | account_id | số dư đã vật chất hoá + version/last_entry_id, để đọc nhanh |
| idempotency_keys | (key, endpoint) | trạng thái, kết quả đã trả, TTL 24-72 giờ |

**Bút toán kép (double-entry)**: mọi giao dịch sinh ra ít nhất hai bút toán có tổng bằng **0**. A chuyển 100 cho B: [[(A, -100), (B, +100)]]. Nạp tiền 100: [[(tài khoản hệ thống nguồn, -100), (A, +100)]]. Tính chất này cho bạn một bất biến kiểm tra được bất cứ lúc nào: **tổng mọi entry của toàn hệ luôn bằng 0**. Một query duy nhất phát hiện mọi lỗi làm sinh hoặc mất tiền. Không có tính chất đó thì bạn chỉ biết sai khi khách kêu.

**Số dư là dữ liệu phái sinh**: [[balance = SUM(amount) FROM entries WHERE account_id = ?]]. Vì tổng này đắt dần theo thời gian, ta **vật chất hoá** vào bảng balances và cập nhật trong **cùng transaction** với việc ghi entry — nhưng bản gốc của sự thật vẫn là entries, và bảng balances có thể dựng lại bất cứ lúc nào. Đây là câu chốt của bài.

## 4. Đào sâu (15–18 phút)
### 4.1 Chuyển tiền: một transaction, thứ tự khoá cố định
~~~
BEGIN;
  -- khoá theo thứ tự account_id tăng dần để tránh deadlock
  SELECT balance FROM balances WHERE account_id IN (:from, :to) ORDER BY account_id FOR UPDATE;
  -- kiểm tra đủ tiền
  IF balance_from < :amount THEN ROLLBACK; -- trả lỗi nghiệp vụ
  INSERT INTO transactions (id, idempotency_key, type, status) VALUES (...);  -- unique key
  INSERT INTO entries (transaction_id, account_id, amount) VALUES (:tx, :from, -:amount), (:tx, :to, +:amount);
  UPDATE balances SET balance = balance - :amount, last_entry_id = ... WHERE account_id = :from;
  UPDATE balances SET balance = balance + :amount WHERE account_id = :to;
  INSERT INTO outbox (...);   -- thông báo, báo cáo
COMMIT;
~~~
Ba chi tiết phải nói: **khoá theo thứ tự cố định** (sắp xếp theo account_id) nếu không thì hai lệnh chuyển ngược chiều sẽ deadlock; **unique constraint trên idempotency_key** là thứ thật sự chống trùng, không phải kiểm tra trước rồi ghi sau; và **outbox trong cùng transaction** (B7) thay vì publish sau commit.

### 4.2 Idempotency cho đúng
Client retry là chuyện bình thường (mạng chập, người dùng bấm hai lần). Quy trình: client gửi [[Idempotency-Key]]; server insert khoá với trạng thái IN_PROGRESS — nếu vi phạm unique thì có hai trường hợp: đã xong thì **trả lại đúng kết quả cũ**, đang chạy thì trả 409 để client thử lại sau. Sai lầm hay gặp là coi idempotency là "nếu đã tồn tại thì bỏ qua" rồi trả 200 rỗng — client không biết tiền đã chuyển hay chưa, và sẽ chuyển lần nữa bằng khoá mới.

### 4.3 Nạp và rút: saga với thế giới bên ngoài
Ngân hàng/PSP không tham gia transaction của bạn, nên nạp tiền là một saga có trạng thái rõ ràng:
| Bước | Bút toán | Trạng thái |
|---|---|---|
| Tạo yêu cầu nạp | chưa có entry | PENDING |
| PSP báo thành công (webhook) | (clearing, -100), (user, +100) | COMPLETED |
| PSP báo thất bại | không ghi entry | FAILED |
| Chargeback sau vài ngày | bút toán **ngược** mới, không xoá cũ | REVERSED |

Rút tiền thì ngược: **giữ tiền trước** bằng bút toán chuyển từ ví người dùng sang tài khoản "đang xử lý" (nên số dư khả dụng giảm ngay, không cho rút hai lần), rồi mới gọi PSP; thất bại thì ghi bút toán hoàn về. Nguyên tắc tuyệt đối: **không bao giờ sửa hoặc xoá bút toán đã ghi** — sửa sai bằng bút toán ngược (reversal). Đó là thứ làm sổ sách kiểm toán được.
- Webhook phải idempotent (PSP gửi lại nhiều lần) và phải xác thực chữ ký; lưu [[provider_event_id]] unique.

### 4.4 Hot account: ví merchant nhận nghìn giao dịch mỗi giây
Dòng balances của merchant trở thành điểm tranh chấp, mọi giao dịch xếp hàng chờ khoá. Ba cách:
1. **Chia nhỏ số dư (balance sharding)**: ví merchant có N dòng con, mỗi giao dịch cập nhật ngẫu nhiên một dòng; số dư thật = tổng N dòng. Đây là cách phổ biến nhất.
2. **Chỉ ghi entry, không cập nhật balance đồng bộ**: số dư tính bằng tổng entries (hoặc snapshot + delta), cập nhật balances bất đồng bộ. Đúng về tiền, đổi lại số dư hiển thị trễ.
3. **Gộp theo lô**: cộng dồn trong vài trăm ms rồi ghi một lần — phù hợp khi merchant không cần thấy từng giao dịch tức thì.
Chọn 1 hoặc 2 và nói rõ hệ quả cho người đọc số dư.

### 4.5 Đối soát: thứ phân biệt hệ thật với hệ trong slide
Ba mức, chạy hằng ngày và tự động báo động:
- **Nội bộ**: [[SUM(amount) FROM entries]] toàn hệ phải bằng **0**; và với mỗi tài khoản, [[balances.balance]] phải bằng tổng entries của nó. Lệch là sự cố mức cao nhất, dừng ghi nếu cần.
- **Với đối tác**: so sao kê của PSP/ngân hàng với entries theo từng giao dịch; chênh lệch rơi vào ba nhóm — có ở ta không có ở họ, có ở họ không có ở ta, cùng có nhưng khác số — và mỗi nhóm có quy trình xử lý riêng.
- **Theo thời gian**: snapshot số dư cuối ngày để không phải cộng lại toàn bộ lịch sử và để có mốc so sánh khi điều tra.

### 4.6 Tiền và kiểu dữ liệu
Dùng **số nguyên đơn vị nhỏ nhất** (đồng, cent) hoặc [[NUMERIC]], **không bao giờ dùng float**. Nêu được câu này mất 5 giây và là dấu hiệu nhận biết người đã làm thật. Kèm theo: mọi số tiền đi với mã tiền tệ; làm tròn phải có quy tắc rõ và phải ghi phần dư vào một tài khoản chênh lệch chứ không cho bốc hơi.

### 4.7 Mở rộng khi thật sự cần
15k dòng/s là trong tầm một node; khi vượt thì shard theo [[account_id]] — nhưng chuyển tiền giữa hai shard mất tính nguyên tử, phải chuyển sang saga hai bước qua tài khoản clearing trung gian. Nói được "tôi trì hoãn sharding càng lâu càng tốt vì nó phá tính nguyên tử của chuyển tiền" là câu trả lời trưởng thành. Phần lịch sử cũ thì partition theo thời gian và chuyển sang lưu trữ lạnh.

## 5. Trade-off & câu hỏi vặn (5 phút)
- **Vật chất hoá số dư hay tính on-the-fly**: vật chất hoá cho đọc nhanh nhưng thêm chỗ có thể lệch; tính on-the-fly luôn đúng nhưng chậm dần. Thực tế: snapshot + delta.
- **Chặt về nhất quán hay sẵn sàng**: với tiền thì chọn nhất quán, từ chối giao dịch còn hơn ghi sai; nói thẳng điều đó.
- **Event sourcing**: sổ cái vốn đã là event sourcing cho tiền; không cần thêm một khung event sourcing tổng quát lên trên.

### Sai lầm hay gặp
- Lưu số dư như một cột và UPDATE nó, không có entries — mất khả năng kiểm toán và không phát hiện được sai.
- Dùng float cho tiền.
- Sửa hoặc xoá bút toán khi có lỗi thay vì ghi bút toán ngược.
- Idempotency bằng "kiểm tra tồn tại rồi ghi" (có cửa sổ đua) thay vì unique constraint.
- Khoá hai tài khoản không theo thứ tự cố định → deadlock dưới tải.
- Quên tài khoản clearing cho tiền đang trên đường từ ngân hàng về.
- Không có đối soát, nên sai sót chỉ lộ ra khi khách phàn nàn.
- Vội vàng sharding khi 15k dòng/s chưa cần, rồi tự phá mất tính nguyên tử.

## 6. Người phỏng vấn chấm gì
Nói ra bút toán kép và bất biến tổng bằng 0 trong 2 phút đầu của phần thiết kế; số dư là dữ liệu phái sinh; idempotency bằng ràng buộc duy nhất; thứ tự khoá; saga cho PSP với tài khoản clearing; bút toán ngược thay vì sửa; đối soát hằng ngày; kiểu dữ liệu tiền. Ai nói đủ ngần ấy thì gần như chắc chắn qua vòng này.

### Nói thế nào trong phỏng vấn (EN)
- "The balance is derived data: the source of truth is an append-only ledger of entries, and every transaction writes at least two entries that sum to zero." — Câu quan trọng nhất của bài.
- "That invariant gives me a cheap global check: the sum of all entries across the system must always be zero, and I alert on any drift." — Bất biến kiểm tra được.
- "I never update or delete an entry; a mistake is corrected with a reversing entry so the audit trail stays complete." — Sửa sai đúng cách.
- "Idempotency is enforced by a unique constraint on the key, and on conflict I return the original result rather than an empty success." — Idempotency đúng.
- "I lock the two accounts in a fixed order by account id, otherwise two opposite transfers deadlock under load." — Chi tiết thực chiến.
- "Money in flight from the bank lives in a clearing account, so it is always visible somewhere in the ledger rather than disappearing between systems." — Tài khoản trung gian.
- "Amounts are integers in the smallest unit; floating point has no place in a ledger." — Câu ngắn, ghi điểm nhanh.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Hệ của bạn không có tiền, nhưng có **một thứ cư xử y hệt tiền: violation**. Nó phải không mất, phải giải thích được vì sao có, phải tái dựng được tại một thời điểm cho mục đích audit — đúng các yêu cầu của sổ cái. Sự cố #14 (reconcile xoá mềm 910k violation) về bản chất là **sửa sổ cái tại chỗ thay vì ghi bút toán**.
- Áp mô hình append-only vào đó: thay vì UPDATE/soft-delete trên bảng violation, ghi [[violation_events]] chỉ thêm (phát hiện, biến mất, được miễn trừ, đóng) kèm [[eval_run_id]]; bảng [[violations]] hiện hành là **dữ liệu phái sinh** dựng từ event, đổi bằng generation swap trong một transaction. Khi đó một lần eval lỗi không thể xoá lịch sử, và bạn trả lời được câu hỏi audit "ngày 3 tháng 2 hệ thống thấy gì".
- Bất biến kiểm tra được là thứ nên bắt chước nguyên văn: với sổ cái là tổng bằng 0; với bạn là **số violation hiện hành của một (target, policy, revision) phải bằng số event mở trừ số event đóng**. Một job chạy mỗi đêm so hai con số và alert khi lệch sẽ bắt được sự cố #14 ngay lần chạy đầu thay vì sau 910k dòng.
- Idempotency bằng **ràng buộc duy nhất** chứ không phải kiểm tra trước: [[UNIQUE(tenant_id, sha256(file))]] cho upload SBOM, [[UNIQUE(provider_event_id)]] cho callback từ Lambda enrichment. Kiểu "SELECT rồi INSERT" có cửa sổ đua và dưới tải sẽ tạo revision đôi.
- Thứ tự khoá cố định áp thẳng vào policy eval: khi một transaction ghi violation cho nhiều target, **sắp xếp theo target_id trước khi khoá**; 10 goroutine song song của bạn (sự cố #3) từng gây lock wait đúng vì thiếu quy tắc này.
- Tài khoản clearing có bản sao trong miền của bạn: component đã gửi đi enrichment nhưng chưa có kết quả đang "trên đường", và hiện nó chỉ là trạng thái pending mơ hồ (sự cố #2 pending kẹt hàng giờ). Coi nó như clearing: luôn đếm được bao nhiêu đang trên đường, bao nhiêu quá hạn, và có job đối soát mỗi giờ.
- Việc thứ Sáu: viết một query kiểm tra bất biến cho một tenant bất kỳ và chạy thử trên production đọc. Nếu nó lệch, bạn vừa tìm ra một sự cố chưa ai biết; nếu không lệch, bạn có một check để đưa vào cron. Cả hai kết quả đều đáng giá, và cả hai đều là câu chuyện tốt cho vòng phỏng vấn.
`,
  quiz: [
    { t: 'mc', q: 'Vì sao không lưu số dư như một cột và UPDATE nó khi có giao dịch?', o: ['Vì UPDATE chậm hơn INSERT', 'Vì mất khả năng kiểm toán và không có bất biến nào để phát hiện tiền bị sinh ra hay mất đi; số dư phải là dữ liệu phái sinh từ sổ bút toán chỉ-thêm', 'Vì Postgres không hỗ trợ UPDATE đồng thời', 'Vì số dư phải lưu ở Redis cho nhanh'], a: 1, why: 'Sổ cái append-only cho phép tái dựng số dư tại mọi thời điểm và cho bất biến tổng entry bằng 0.' },
    { t: 'mc', q: 'Bất biến toàn cục nào của hệ bút toán kép giúp phát hiện mọi lỗi làm sinh hoặc mất tiền?', o: ['Số lượng transaction bằng số lượng entry', 'Tổng amount của toàn bộ entries trong hệ luôn bằng 0', 'Mọi account có số dư không âm', 'Số entry luôn là số chẵn'], a: 1, why: 'Mỗi giao dịch ghi các entry có tổng bằng 0, nên tổng toàn hệ phải bằng 0; một query là đủ để kiểm tra.' },
    { t: 'mc', q: 'Phát hiện một giao dịch ghi sai số tiền từ hôm qua. Cách xử lý đúng?', o: ['UPDATE entry đó về số đúng', 'DELETE entry sai rồi INSERT entry mới', 'Ghi bút toán ngược (reversal) để huỷ hiệu lực giao dịch cũ, rồi ghi giao dịch đúng', 'Sửa trực tiếp bảng balances cho khớp'], a: 2, why: 'Sổ cái là chỉ-thêm; sửa hoặc xoá phá dấu vết kiểm toán và làm mất khả năng giải thích lịch sử.' },
    { t: 'mc', q: 'Hai người dùng chuyển tiền cho nhau cùng lúc theo hai chiều ngược nhau, hệ bắt đầu báo deadlock. Nguyên nhân và cách chữa?', o: ['Thiếu index trên bảng entries; thêm index', 'Isolation level quá cao; hạ xuống READ UNCOMMITTED', 'Hai transaction khoá hai dòng theo thứ tự khác nhau; luôn khoá theo thứ tự account_id tăng dần', 'Pool kết nối quá nhỏ; tăng pool'], a: 2, why: 'Deadlock kinh điển do thứ tự khoá; quy tắc sắp xếp khoá theo một thứ tự toàn cục cố định là cách chữa chuẩn.' },
    { t: 'mc', q: 'Client gửi lại yêu cầu chuyển tiền với cùng Idempotency-Key sau khi lần đầu đã thành công. Server nên làm gì?', o: ['Trả 200 với body rỗng', 'Bỏ qua im lặng', 'Trả lại đúng kết quả của lần đầu (cùng transaction_id và trạng thái)', 'Tạo giao dịch mới vì client đã chủ động gửi lại'], a: 2, why: 'Trả rỗng khiến client không biết tiền đã chuyển hay chưa và sẽ thử lại bằng khoá mới, dẫn tới chuyển hai lần.' },
    { t: 'fill', q: 'Điền: nguyên tắc kế toán trong đó mỗi giao dịch sinh ít nhất hai bút toán có tổng bằng 0 gọi là sổ cái ___.', a: ['bút toán kép', 'double-entry', 'kép'], why: 'Chính tính chất này tạo ra bất biến kiểm tra được và khả năng kiểm toán.' },
    { t: 'fill', q: 'Điền: tài khoản trung gian giữ tiền đang trên đường từ ngân hàng về ví người dùng, để tiền luôn nhìn thấy được ở đâu đó trong sổ cái, gọi là tài khoản ___.', a: ['clearing', 'trung gian', 'suspense'], why: 'Không có nó thì tiền biến mất khỏi sổ trong khoảng thời gian giữa hai hệ thống và không đối soát được.' },
    { t: 'open', q: 'Job đối soát sáng nay báo tổng toàn hệ lệch 1 200 000 đồng so với 0. Trình bày cách bạn điều tra và những biện pháp khiến lần sau phát hiện trong vài phút thay vì một ngày.', a: 'Trước hết coi là sự cố mức cao nhất và quyết định có chặn ghi hay không dựa trên mức lệch và tốc độ tăng; nếu lệch đang tăng thì tạm dừng đường ghi gây nghi ngờ. Khoanh vùng theo thời gian bằng cách tính tổng entries theo từng giờ để tìm giờ đầu tiên lệch, rồi theo loại giao dịch và theo tài khoản để thu hẹp. Vì sổ cái là chỉ-thêm nên mọi thứ cần thiết đều còn trong dữ liệu. Giả thuyết thường gặp: một đường ghi mới chỉ ghi một entry thay vì hai, một job sửa trực tiếp bảng balances mà không qua ledger, một webhook của PSP được xử lý hai lần vì thiếu unique trên provider_event_id, hoặc làm tròn bỏ phần dư thay vì đưa vào tài khoản chênh lệch. Sửa bằng bút toán điều chỉnh có ghi chú và liên kết tới sự cố, tuyệt đối không UPDATE dữ liệu cũ. Để lần sau phát hiện nhanh: chạy kiểm tra bất biến mỗi 5 phút trên dữ liệu gia tăng thay vì mỗi ngày trên toàn bộ, thêm ràng buộc ở tầng DB buộc mọi transaction phải có tập entry tổng bằng 0 thông qua trigger hoặc qua một hàm duy nhất được phép ghi ledger, cấm mọi đường ghi trực tiếp vào balances, thêm metric độ lệch và alert khi khác 0, và bổ sung test tích hợp cho mỗi loại giao dịch kiểm tra bất biến ngay trong CI. Cuối cùng viết postmortem nêu rõ vì sao đường ghi đó vượt qua được review.', keys: ['bất biến', 'append-only', 'bút toán ngược', 'alert', 'postmortem'] }
  ]
}
];
