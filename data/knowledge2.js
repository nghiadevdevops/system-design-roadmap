/* ===== Giai đoạn 4 · Kiến thức phỏng vấn (bổ sung, K13): vòng coding ===== */
window.LESSONS_K2 = [
{ id: 'K13', type: 'knowledge', topic: 'go', title: 'Vòng coding cho backend: độ phức tạp, 10 dạng bài, bài "design in code", và cách nói khi đang gõ', time: '150 phút',
  goal: 'Nhận dạng được dạng bài trong 60 giây đầu và nói ra độ phức tạp trước khi gõ; viết đúng 10 khuôn mẫu cơ bản bằng Go mà không cần nhớ thư viện lạ; làm được nhóm bài "design in code" (LRU, rate limiter, parse log) vốn hay gặp hơn nhiều ở mức mid–senior; có kế hoạch luyện 6 tuần thay vì cày ngẫu nhiên.',
  md: `
### Vấn đề cần giải
Gần như mọi vòng phỏng vấn backend đều có một buổi coding 45–60 phút trước hoặc sau vòng system design, và nhiều người giỏi thiết kế vẫn trượt ở đây vì ba lý do rất cụ thể: không nhận ra dạng bài nên loay hoay 15 phút; code chạy nhưng không nói được độ phức tạp; hoặc im lặng gõ rồi đưa ra một đoạn không chạy. Tin tốt: ở mức mid–senior, đề **không khó như thi thuật toán**. Người ta muốn thấy bạn viết được code sạch, đúng biên, có test, và **nói được vì sao**. Nhiều công ty còn thay hẳn bằng nhóm bài "design in code" — hiện thực một LRU cache, một rate limiter, một parser log — vốn gần công việc thật hơn.

Bài này không dạy bạn giải một nghìn bài. Nó cho bạn **mười khuôn mẫu phủ phần lớn đề**, cách nói khi đang gõ, và một kế hoạch luyện có giới hạn thời gian.

### Cốt lõi
#### Độ phức tạp: bốn câu phải bật ra ngay
| Khi nhìn thấy | Nghĩ ngay tới |
|---|---|
| Mảng chưa sắp xếp, cần tra nhanh | Hash map, O(n) thời gian và O(n) bộ nhớ |
| Dữ liệu đã sắp xếp, hoặc "tìm giá trị nhỏ nhất thoả điều kiện" | Binary search, O(log n) |
| Cần k phần tử lớn nhất | Heap kích thước k, O(n log k) |
| Quan hệ phụ thuộc, đường đi, nhóm liên thông | BFS/DFS/topological sort, O(V + E) |

Hai sai lầm phổ biến khi nói về độ phức tạp: quên **bộ nhớ** (người phỏng vấn gần như luôn hỏi tiếp), và nói O(n) cho vòng lặp có chứa một phép [[strings.Contains]] hay một lần cắt slice bên trong. Nếu có thao tác chuỗi trong vòng lặp thì nói rõ O(n·m).

#### Mười khuôn mẫu phủ phần lớn đề
1. **Đếm bằng hash map** — hai tổng, anagram, phần tử xuất hiện nhiều nhất, tìm trùng. Dấu hiệu: "có tồn tại", "đếm", "ghép cặp".
2. **Hai con trỏ** — mảng đã sắp xếp, tìm cặp, loại trùng tại chỗ, đảo chuỗi. Dấu hiệu: mảng sắp xếp và cần O(1) bộ nhớ.
3. **Cửa sổ trượt** — chuỗi con dài nhất không lặp ký tự, tổng lớn nhất của k phần tử liên tiếp, rate limit theo cửa sổ. Dấu hiệu: "liên tiếp", "chuỗi con", "trong một khoảng".
4. **Binary search, kể cả trên đáp án** — tìm vị trí chèn; và dạng mạnh hơn: "số máy chủ ít nhất để xử lý trong T phút" (tìm nhị phân trên không gian đáp án). Dấu hiệu: hàm đơn điệu theo tham số.
5. **Sắp xếp rồi quét** — gộp khoảng (interval merge), lịch phòng họp, phát hiện chồng lấn. Dấu hiệu: bài có khoảng thời gian hoặc đoạn.
6. **Heap / top-K** — k phần tử lớn nhất, k log gần nhất, trộn k danh sách đã sắp xếp. Trong Go dùng [[container/heap]]; biết cách khai báo interface năm phương thức là đủ.
7. **BFS và DFS trên đồ thị** — đường ngắn nhất trên đồ thị không trọng số là BFS; đếm vùng liên thông là DFS hoặc union-find; dò chu trình là DFS với ba màu.
8. **Topological sort** — thứ tự build, thứ tự cài gói, phát hiện phụ thuộc vòng. Kahn với mảng in-degree dễ viết đúng hơn DFS đệ quy, và trả được lỗi khi có chu trình.
9. **Tổng tiền tố (prefix sum)** — tổng đoạn, số đoạn con có tổng bằng k. Kết hợp với hash map là một trong những cặp hay gặp nhất.
10. **Quy hoạch động cơ bản** — leo cầu thang, đổi tiền, chuỗi con chung dài nhất. Ở mức mid–senior hiếm khi đi xa hơn, nhưng phải nhận ra "có lựa chọn và có trạng thái lặp lại".

Nếu bạn nắm chắc mười dạng này và viết được mỗi dạng trong 10 phút, bạn qua phần lớn vòng coding backend. Thứ còn thiếu không phải là dạng thứ mười một, mà là **tốc độ nhận dạng** và **sự sạch sẽ khi gõ**.

#### Nhóm bài "design in code": thực ra hay gặp hơn
Đây là nơi kinh nghiệm backend của bạn thắng người chỉ cày thuật toán. Bốn đề kinh điển:
- **LRU cache** (hash map + danh sách liên kết đôi, mọi thao tác O(1)). Trong Go có [[container/list]]; nên tự viết node hai chiều để kiểm soát. Câu vặn chắc chắn: "làm cho nó an toàn khi nhiều goroutine dùng" — trả lời bằng mutex bao quanh, rồi nói về sharding khoá nếu cần giảm tranh chấp.
- **Rate limiter token bucket** (mốc thời gian cuối + số token, nạp theo thời gian trôi qua, không cần goroutine nền). Câu vặn: "phân tán thì sao" — dẫn sang Redis và Lua (B9).
- **Parse và tổng hợp log** (đọc theo dòng, không nạp cả file; gom theo khoá; top-K bằng heap). Câu vặn: "file 50 GB" — trả lời bằng streaming và xử lý theo lô.
- **Thư viện retry/timeout nhỏ** ([[context.Context]], backoff có jitter, dừng đúng lúc). Câu vặn: "retry vô hạn thì sao" — retry budget, circuit breaker (B17).

Nhóm này chấm **thiết kế API của hàm, xử lý lỗi, và an toàn đồng thời**, không chấm mẹo thuật toán. Hãy nói to ba thứ đó khi làm.

#### Go: những chỗ dễ sai trong lúc phỏng vấn
~~~
// 1. append có thể dùng chung mảng nền: hai slice sửa lẫn nhau
a := []int{1, 2, 3, 4}
b := a[:2]
b = append(b, 99)      // a[2] vừa bị ghi đè thành 99
// Cách an toàn: b := append([]int(nil), a[:2]...)

// 2. lặp map không có thứ tự; muốn ổn định thì lấy khoá ra rồi sort
keys := make([]string, 0, len(m))
for k := range m { keys = append(keys, k) }
sort.Strings(keys)

// 3. biến vòng lặp trong goroutine (Go trước 1.22 dùng chung biến)
for _, v := range items { go func(v Item) { use(v) }(v) }

// 4. so sánh rune chứ không so sánh byte khi xử lý tiếng Việt
for _, r := range s { ... }   // range trên string trả về rune

// 5. sort.Slice với hàm less, không cần tự viết interface
sort.Slice(xs, func(i, j int) bool { return xs[i].Score > xs[j].Score })
~~~
Biết sẵn năm chỗ này tiết kiệm đúng những phút bạn không có.

#### Cách nói trong 45 phút: khuôn năm bước
| Phút | Việc | Câu nên nói |
|---|---|---|
| 0–3 | Làm rõ | "Đầu vào có thể rỗng không? Có ký tự unicode không? Dữ liệu vừa bộ nhớ chứ?" |
| 3–6 | Ví dụ bằng tay | Chạy tay một ví dụ nhỏ và một ví dụ biên, viết ra kết quả kỳ vọng |
| 6–10 | Chốt cách làm | "Cách ngây thơ là O(n²); tôi dùng hash map để xuống O(n) đổi lấy O(n) bộ nhớ. Tôi viết cách đó nhé?" |
| 10–30 | Gõ | Nói khi làm việc khó, im lặng khi gõ việc máy móc; đặt tên biến tử tế |
| 30–40 | Tự kiểm | Chạy tay lại với ví dụ ban đầu, rồi với rỗng, một phần tử, trùng nhau, tràn số |
| 40–45 | Mở rộng | "Nếu dữ liệu không vừa RAM thì tôi chia lô và dùng external sort" |

Hai quy tắc đáng giá nhất: **chốt cách làm trước khi gõ** (sai hướng mà gõ 20 phút là hết giờ), và **tự tìm lỗi trước khi người phỏng vấn tìm** — tự chạy tay ca biên rồi sửa sẽ được chấm cao hơn code đúng ngay nhưng im lặng.

#### Ca biên bạn phải tự hỏi mỗi bài
Rỗng; một phần tử; mọi phần tử bằng nhau; đã sắp xếp và sắp xếp ngược; số âm và số 0; trùng lặp; tràn số nguyên; chuỗi có unicode; đầu vào rất lớn. Đọc thuộc danh sách này và quét qua nó ở phút 30.

#### Kế hoạch luyện 6 tuần, có giới hạn
- **Tuần 1–2**: mỗi dạng trong mười dạng, giải 3 bài **dễ**, tự bấm giờ 20 phút. Mục tiêu là nhận dạng, không phải khó.
- **Tuần 3–4**: 2 bài **trung bình** mỗi dạng, bấm giờ 35 phút, bắt buộc nói to như đang phỏng vấn (ghi âm).
- **Tuần 5**: bốn bài design in code (LRU, rate limiter, log parser, retry), mỗi bài 45 phút, có test.
- **Tuần 6**: 4 buổi mô phỏng đầy đủ 45 phút với bài chưa gặp, tự chấm theo: nhận dạng đúng trong 3 phút, chốt độ phức tạp trước khi gõ, code chạy, tự tìm ra ít nhất một lỗi biên.
- Quy tắc chống phí thời gian: **quá 25 phút không ra hướng thì đọc lời giải**, hiểu, rồi ghi bài đó vào danh sách làm lại sau 3 ngày. Cày mù là cách tốn thời gian nhất.

### Sai lầm hay gặp
- Gõ ngay khi nghe xong đề, không làm rõ, không chốt cách làm.
- Im lặng 10 phút rồi đưa ra code — người phỏng vấn không chấm được quá trình suy nghĩ.
- Không nói độ phức tạp, hoặc nói sai vì quên thao tác bên trong vòng lặp.
- Quên bộ nhớ khi tính độ phức tạp.
- Đặt tên biến [[a]], [[b]], [[tmp2]] rồi chính mình nhầm.
- Không chạy tay ví dụ nào trước khi tuyên bố "xong".
- Học thuộc lời giải thay vì học dạng; đề đổi một chi tiết là hỏng.
- Bỏ qua nhóm design in code dù nó hay gặp hơn ở mức mid–senior.

### Nói thế nào trong phỏng vấn (EN)
- "Let me restate the problem and run one small example by hand before I write anything." — Mở đầu chuẩn.
- "The brute force is O(n squared) in time and constant in space; I can trade memory for time with a hash map and get O(n) and O(n). Shall I write that one?" — Chốt hướng và xin xác nhận.
- "I will handle the empty input and the single element case explicitly, then walk through my original example to check." — Chủ động ca biên.
- "This is O(n log k) because the heap never exceeds k elements, and O(k) extra memory." — Nói đủ cả thời gian và bộ nhớ.
- "For thread safety I would wrap this in a mutex; if contention becomes a problem I would shard by key hash rather than use one global lock." — Câu trả lời backend cho bài design in code.
- "If the input does not fit in memory I would stream it line by line and keep only the aggregate state." — Mở rộng đúng hướng.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Dạng bài trong đời thật của bạn, dùng để luyện thay cho đề ngẫu nhiên: **gộp khoảng phiên bản bị ảnh hưởng** của một CVE (interval merge, dạng số 5); **sắp xếp topo đồ thị phụ thuộc** của một SBOM để phát hiện phụ thuộc vòng (dạng số 8); **top-K CVE theo số target bị ảnh hưởng** (heap, dạng số 6); **đếm component trùng giữa các target** (hash map, dạng số 1). Luyện bằng dữ liệu thật thì vừa ôn thuật toán vừa ra được công cụ dùng được.
- LRU cache không phải bài tập suông với bạn: cache enrichment theo coordinate đúng là chỗ cần nó, và câu vặn "an toàn khi nhiều goroutine" là chuyện bạn đã gặp thật ở worker 10 goroutine (sự cố #3). Viết một LRU có mutex, đo tranh chấp, rồi thử sharding theo hash khoá — đó là một buổi luyện và một PR có ích.
- Rate limiter token bucket trong Go bạn đã làm ở lab L7; hãy viết lại **từ đầu không nhìn lại** trong 45 phút như một buổi mô phỏng. Code đã từng viết mà viết lại được dưới áp lực thời gian mới là thứ dùng được trong phỏng vấn.
- Parser log 50 GB ánh xạ thẳng vào sự cố #11 (export dùng OFFSET và ReadAll vào RAM): bài học giống hệt nhau là streaming theo dòng và chỉ giữ trạng thái tổng hợp. Kể lại được sự cố đó khi làm bài design in code là cách biến vòng coding thành cơ hội ghi điểm kinh nghiệm.
- Năm bẫy Go ở trên đều có vết trong hệ của bạn: append dùng chung mảng nền, thứ tự lặp map không ổn định làm test nháy, biến vòng lặp trong goroutine. Thêm [[go test -race]] vào CI nếu chưa có — vừa là việc nên làm, vừa là câu trả lời sẵn khi được hỏi "bạn bắt data race thế nào".
- Việc thứ Sáu: chọn một trong bốn dạng trên, viết thành một lệnh nhỏ trong [[dcn_toolbox]] (ví dụ [[sbom topo]] phát hiện phụ thuộc vòng), kèm test có ca biên. Ghi vào Sổ tay thời gian làm và lỗi biên tự tìm ra — đó là số liệu để biết mình đã sẵn sàng cho vòng coding chưa.
`,
  quiz: [
    { t: 'mc', q: 'Đề: "cho mảng chưa sắp xếp, tìm k phần tử lớn nhất". Cách tốt nhất và độ phức tạp?', o: ['Sắp xếp toàn mảng rồi lấy k phần tử đầu, O(n log n)', 'Min-heap kích thước k, duyệt một lượt, O(n log k) thời gian và O(k) bộ nhớ', 'Duyệt k lần tìm max, O(n·k)', 'Dùng hash map đếm tần suất, O(n)'], a: 1, why: 'Heap kích thước k tốt hơn sắp xếp khi k nhỏ hơn n nhiều; nhớ nói cả bộ nhớ O(k).' },
    { t: 'mc', q: 'Đề cho mảng đã sắp xếp và yêu cầu tìm cặp có tổng bằng target với bộ nhớ O(1). Khuôn mẫu nào?', o: ['Hash map lưu phần bù', 'Hai con trỏ từ hai đầu đi vào', 'Cửa sổ trượt', 'Quy hoạch động'], a: 1, why: 'Hash map cho O(n) thời gian nhưng O(n) bộ nhớ; ràng buộc O(1) bộ nhớ cộng với mảng đã sắp xếp là dấu hiệu kinh điển của hai con trỏ.' },
    { t: 'mc', q: 'Bài "tìm số worker ít nhất để xử lý hết hàng đợi trong T phút". Nhận dạng đúng là gì?', o: ['Quy hoạch động trên số worker', 'Binary search trên không gian đáp án, vì hàm kiểm tra khả thi là đơn điệu theo số worker', 'Greedy chia đều', 'BFS trên đồ thị trạng thái'], a: 1, why: 'Nhiều worker hơn thì luôn vẫn khả thi, nên tồn tại ngưỡng; tìm nhị phân ngưỡng đó với một hàm feasible(x).' },
    { t: 'mc', q: 'Trong Go, đoạn: a := []int{1,2,3,4}; b := a[:2]; b = append(b, 99). Điều gì xảy ra?', o: ['a không đổi, b là bản sao độc lập', 'a[2] bị ghi đè thành 99 vì b dùng chung mảng nền còn dư sức chứa', 'Chương trình panic vì vượt biên', 'b trở thành nil'], a: 1, why: 'Slice cắt ra dùng chung mảng nền; append khi còn capacity sẽ ghi đè phần tử kế tiếp của mảng gốc.' },
    { t: 'mc', q: 'Người phỏng vấn yêu cầu hiện thực LRU cache với get và put đều O(1). Cấu trúc nào?', o: ['Mảng có sắp xếp theo thời gian truy cập', 'Hash map tới node của một danh sách liên kết đôi, mỗi lần truy cập thì chuyển node lên đầu', 'Min-heap theo timestamp', 'Hai hash map, một cho giá trị một cho thời gian'], a: 1, why: 'Heap cho O(log n); danh sách liên kết đôi cho phép tách và chèn node ở O(1), hash map cho tra O(1).' },
    { t: 'fill', q: 'Điền: thuật toán sắp xếp thứ tự các công việc theo quan hệ phụ thuộc, đồng thời phát hiện được phụ thuộc vòng, gọi là ___ sort.', a: ['topological', 'topo'], why: 'Kahn dùng mảng in-degree dễ viết đúng hơn DFS đệ quy và trả lỗi tự nhiên khi còn node chưa xử lý.' },
    { t: 'fill', q: 'Điền: kỹ thuật tính trước tổng dồn để trả lời tổng của một đoạn bất kỳ trong O(1), gọi là ___ sum.', a: ['prefix', 'tiền tố', 'prefix sum'], why: 'Kết hợp prefix sum với hash map là cặp hay gặp cho bài đếm số đoạn con có tổng bằng k.' },
    { t: 'open', q: 'Bạn được giao bài: "viết hàm nhận một file log 50 GB và trả về 10 endpoint chậm nhất theo p95". Trình bày cách bạn làm trong 45 phút, gồm cả cách nói với người phỏng vấn.', a: 'Bắt đầu bằng làm rõ: định dạng mỗi dòng ra sao, p95 tính theo endpoint hay toàn cục, có cần chính xác tuyệt đối không, chạy một máy hay nhiều máy, bộ nhớ cho phép bao nhiêu. Chốt hướng trước khi gõ: không nạp cả file vào RAM mà đọc theo dòng bằng bufio.Scanner với buffer đủ lớn, parse lấy endpoint và latency, bỏ qua dòng hỏng thay vì panic và đếm số dòng hỏng. Với p95 thì nói rõ đánh đổi: giữ toàn bộ latency của mỗi endpoint là O(n) bộ nhớ, nên dùng histogram theo bucket hoặc t-digest cho p95 xấp xỉ với bộ nhớ cố định, và nói sai số chấp nhận được. Sau khi có p95 cho từng endpoint thì lấy top 10 bằng min-heap kích thước 10, O(m log 10) với m là số endpoint. Độ phức tạp tổng: O(n) thời gian theo số dòng, bộ nhớ O(số endpoint nhân số bucket). Tự kiểm bằng ca biên: file rỗng, dòng hỏng, endpoint chỉ có một mẫu, latency bằng 0, số endpoint rất lớn. Mở rộng khi được hỏi: chia file theo khối và xử lý song song bằng worker pool rồi hợp nhất histogram vì histogram cộng được, hoặc đưa lên MapReduce nếu nhiều file; và nhắc rằng đọc tuần tự đĩa là nút thắt nên song song hoá parse mới có ích.', keys: ['streaming', 'bufio', 'histogram', 'heap', 'ca biên'] }
  ]
}
];
