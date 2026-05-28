let rawGpuData = [];
let rawNpuData = [];
let processedItems = [];
let pieChartInstance = null;

const seriesOrder = ['B시리즈', 'H시리즈', 'A시리즈', 'V시리즈', 'L시리즈', 'RTX시리즈', 'NPU', '기타'];
const seriesColors = ['#0ea5e9', '#6366f1', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#10b981', '#94a3b8'];
const seriesBorderColors = ['#0284c7', '#4f46e5', '#d97706', '#dc2626', '#db2777', '#7c3aed', '#059669', '#64748b'];

function switchTab(tabId) {
const contents = document.querySelectorAll('.tab-content');
for(let i=0; i<contents.length; i++) { contents[i].classList.add('hidden'); }
document.getElementById(tabId).classList.remove('hidden');

const btns = document.querySelectorAll('.tab-btn');
for(let i=0; i<btns.length; i++) {
    btns[i].classList.remove('text-blue-600', 'border-b-2', 'border-blue-500');
    btns[i].classList.add('text-slate-500');
}

const activeBtn = document.getElementById('btn-' + tabId);
if(activeBtn) {
    activeBtn.classList.add('text-blue-600', 'border-b-2', 'border-blue-500');
    activeBtn.classList.remove('text-slate-500');
}
}

// 자체 내장 고속 CSV 파서
function nativeCSVParser(text) {
let lines = [];
let row = [""];
let inQuotes = false;
for (let i = 0; i < text.length; i++) {
    let c = text[i];
    let next = text[i+1];
    if (c === '"') {
        if (inQuotes && next === '"') { row[row.length - 1] += '"'; i++; }
        else { inQuotes = !inQuotes; }
    } else if (c === ',' && !inQuotes) {
        row.push("");
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
        if (c === '\r' && next === '\n') { i++; }
        lines.push(row);
        row = [""];
    } else {
        row[row.length - 1] += c;
    }
}
if (row.length > 1 || row[0] !== "") { lines.push(row); }
return lines;
}

// 엑셀 EUC-KR 및 UTF-8 자동 감지 파서
function handleFileUpload(type) {
const fileInput = document.getElementById(type + 'File');
const file = fileInput.files[0];
if (!file) return;

document.getElementById(type + 'FileName').innerText = "데이터 로딩 및 분석 중...";

const reader = new FileReader();

// 국내 엑셀 기본 형식에 맞춰 EUC-KR로 우선 시도
reader.readAsText(file, 'EUC-KR');

reader.onload = function(e) {
    let text = e.target.result;
    
    // 만약 글자가 깨진다면(UTF-8인 경우) 다시 읽기
    if (text.includes('')) {
        const readerUtf8 = new FileReader();
        readerUtf8.readAsText(file, 'UTF-8');
        readerUtf8.onload = function(e2) {
            parseContent(e2.target.result, type, file.name);
        }
    } else {
        parseContent(text, type, file.name);
    }
};

// 동일 파일 재클릭을 위한 입력 초기화
fileInput.value = '';
}

function parseContent(text, type, filename) {
const rows = nativeCSVParser(text);
if (rows.length === 0) {
    alert("파일 내용이 존재하지 않습니다.");
    return;
}

let headerIndex = -1;
for (let i = 0; i < rows.length; i++) {
    let lineStr = rows[i].join(',').replace(/\s/g, ''); // 공백 제거 후 비교
    if (lineStr.includes('신청번호') || lineStr.includes('신청연도')) {
        headerIndex = i;
        break;
    }
}

if (headerIndex === -1) {
    alert("데이터 인식 실패: 컬럼 헤더('신청번호' 또는 '신청연도')를 찾지 못했습니다. 올바른 CSV 포맷인지 확인해 주십시오.");
    document.getElementById(type + 'FileName').innerText = "파일 인식 실패";
    return;
}

let headers = rows[headerIndex].map(h => (h || '').trim().replace(/^[\uFEFF\xA0]+|[\uFEFF\xA0]+$/g, ''));
let jsonList = [];

for (let i = headerIndex + 1; i < rows.length; i++) {
    let row = rows[i];
    if (row.length === 0 || (row.length === 1 && row[0] === '')) continue;
    if (row.join(',').includes('상세 내역') || row[0] === headers[0]) continue;
    
    let obj = {};
    headers.forEach((h, idx) => {
        obj[h] = row[idx] !== undefined ? row[idx] : '';
    });
    jsonList.push(obj);
}

if (type === 'gpu') rawGpuData = jsonList;
else rawNpuData = jsonList;

document.getElementById(type + 'FileName').innerText = filename + " (로드 완료)";
processData();
}

function detectGpuManufacturer(text) {
if (text.includes('APPLE')) return 'Apple';
if (text.includes('ASUS')) return 'ASUS';
if (text.includes('DELL')) return 'Dell';
if (text.includes('LENOVO')) return 'Lenovo';
if (text.includes('HPE')) return 'HPE';
if (text.includes('HP ') || text.includes('HP-') || text.startsWith('HP')) return 'HP';
if (text.includes('SUPERMICRO')) return 'Supermicro';
if (text.includes('GIGABYTE')) return 'Gigabyte';
if (text.includes('PNY')) return 'PNY';
if (text.includes('MSI')) return 'MSI';
if (text.includes('TYAN')) return 'Tyan';
if (text.includes('ZOTAC')) return 'ZOTAC';
if (text.includes('IBM')) return 'IBM';
if (text.includes('INSPUR')) return 'Inspur';
if (text.includes('NVIDIA')) return 'NVIDIA';
if (text.includes('AMD')) return 'AMD';
if (text.includes('INTEL')) return 'Intel';
return '기타';
}

function parseSubModel(combined) {
const rules = [
    { k: 'GB200', v: 'GB200' },
    { k: 'B300', v: 'B300' },
    { k: 'B200', v: 'B200' },
    { k: 'HGX B', v: 'HGX B' },
    { k: 'DGX B', v: 'DGX B' },
    { k: 'H200', v: 'H200' },
    { k: 'H100', v: 'H100' },
    { k: 'GH200', v: 'GH200' },
    { k: 'DGX H100', v: 'DGX H100' },
    { k: 'A100', v: 'A100' },
    { k: 'A800', v: 'A800' },
    { k: 'A40', v: 'A40' },
    { k: 'A30', v: 'A30' },
    { k: 'A16', v: 'A16' },
    { k: 'A10', v: 'A10' },
    { k: 'A2', v: 'A2' },
    { k: 'V100', v: 'V100' },
    { k: 'V40', v: 'V40' },
    { k: 'P100', v: 'P100' },
    { k: 'P40', v: 'P40' },
    { k: 'TESLA', v: 'Tesla' },
    { k: 'L40S', v: 'L40S' },
    { k: 'L40', v: 'L40' },
    { k: 'L4', v: 'L4' },
    { k: 'RTX PRO 6000', v: 'RTX PRO 6000' },
    { k: 'RTX 6000', v: 'RTX 6000' },
    { k: 'RTX A6000', v: 'RTX A6000' },
    { k: 'RTX A5000', v: 'RTX A5000' },
    { k: 'RTX A4000', v: 'RTX A4000' },
    { k: 'RTX 5090', v: 'RTX 5090' },
    { k: 'RTX 4090', v: 'RTX 4090' },
    { k: 'RTX 3090', v: 'RTX 3090' },
    { k: 'RTX 3080', v: 'RTX 3080' },
    { k: 'QUADRO', v: 'QUADRO' }
];
for (let i = 0; i < rules.length; i++) {
    if (combined.includes(rules[i].k)) return rules[i].v;
}
return '기타';
}

// 시리즈 분류 - 엑셀 규칙 + 추가 GPU 모델 커버리지 (매칭 키워드 반환)
function classifyGpuSeries(combined) {
const rules = [
    { keys: ['GB200', 'B300', 'B200', 'HGX B', 'DGX B'], series: 'B시리즈' },
    { keys: ['H200', 'H100', 'GH200', 'DGX H100', 'DGX H'], series: 'H시리즈' },
    { keys: ['A100', 'A800', 'A40', 'A30', 'A16', 'A10'], series: 'A시리즈' },
    { keys: ['V100', 'V40', 'P100', 'P40', 'TESLA'], series: 'V시리즈' },
    { keys: ['L40S', 'L40', 'L4'], series: 'L시리즈' },
    { keys: ['RTX PRO 6000', 'RTX 6000', 'RTX A6000', 'RTX A5000', 'RTX A4000', 'RTX 5090', 'RTX 4090', 'RTX 3090', 'RTX 3080', 'QUADRO'], series: 'RTX시리즈' }
];
for (let rule of rules) {
    for (let k of rule.keys) {
        if (combined.includes(k)) return { series: rule.series, keyword: k };
    }
}
return { series: '기타', keyword: '-' };
}

function processData() {
const startYear = parseInt(document.getElementById('startYear').value) || 2020;
const endYear = parseInt(document.getElementById('endYear').value) || 2026;
const minAmount = parseInt(document.getElementById('minAmount').value) || 0;
const completedOnly = document.getElementById('completedOnly').checked;

processedItems = [];
let reviewCount = 0;
let exclusionCount = 0;

function safeParseInt(val, defaultVal = 0) {
    if (!val) return defaultVal;
    let clean = val.toString().replace(/[^0-9-]/g, '');
    let res = parseInt(clean);
    return isNaN(res) ? defaultVal : res;
}

// 1. GPU 분석 연산
rawGpuData.forEach(row => {
    let amt = safeParseInt(row['추정금액'] || row['구매단가']);
    let qty = safeParseInt(row['물품수량'], 1);
    let dateStr = (row['신청일'] || '').toString().trim();
    let year = parseInt(dateStr.substring(0, 4)) || 0;
    
    let isDone = (row['검수완료여부'] || '').toString().trim().toUpperCase();
    if (completedOnly && isDone !== 'Y') return;

    if (!row['신청번호'] && !row['물품명']) return;
    if (year < startYear || year > endYear) return;
    if (amt < minAmount) return;

    // 제외 판별용 텍스트 (물품명 + 적요 + STD_CLOB)
    const exCheckText = ((row['물품명'] || '') + ' ' + (row['적요'] || '') + ' ' + (row['STD_CLOB'] || '')).toUpperCase();
    // 분류용 텍스트 (모든 칼럼 합본 - 어떤 칼럼에 GPU 모델 정보가 있든 잡힘)
    const fullText = (Object.values(row).join(' ')).toUpperCase();
    const exKeywords = ['INSTALLATION', 'POWER CABLE', 'POWERCABLE', 'AIR DUCT', 'GPU HOLDER', 'ENCLOSURE', 'WATER BLOCK', 'HOLDER'];
    let excluded = false;
    let exReason = '';

    for (let kw of exKeywords) {
        if (exCheckText.includes(kw)) { excluded = true; exReason = `부속품 키워드 (${kw})`; break; }
    }
    if (!excluded && ((row['구매종류명'] || '').includes('용역') || (row['구매종류명'] || '').includes('임차'))) {
        excluded = true; exReason = `구매속성 제외 (${row['구매종류명']})`;
    }

    if (excluded) {
        exclusionCount++;
        processedItems.push({ source: 'GPU', id: row['신청번호'] || 'N/A', year, amt, qty, title: row['물품명'] || '', series: '제외', type: '제외', excluded: true, exReason });
        return;
    }

    let classResult = classifyGpuSeries(fullText);
    let series = classResult.series;
    let matchKeyword = classResult.keyword;
    let subModel = matchKeyword !== '-' ? matchKeyword : parseSubModel(fullText);
    let manufacturer = detectGpuManufacturer(fullText);

    // 분류 근거: 어느 칼럼에서 매칭되었는지 확인
    let matchCol = '-';
    let colTitle = (row['물품명'] || '').toUpperCase();
    let colMemo = (row['적요'] || '').toUpperCase();
    let colClob = (row['STD_CLOB'] || '').toUpperCase();
    if (matchKeyword !== '-') {
        if (colTitle.includes(matchKeyword)) matchCol = '물품명';
        else if (colMemo.includes(matchKeyword)) matchCol = '적요';
        else if (colClob.includes(matchKeyword)) matchCol = 'STD_CLOB';
        else matchCol = '기타칼럼';
    }

    let type = 'GPU단품';
    let itemCategory = (row['물품분류명'] || '').toString();
    let itemName = (row['물품명'] || '').toString();
    if (itemCategory.toUpperCase().includes('SERVER') || itemName.toUpperCase().includes('SERVER') || itemCategory.includes('서버') || itemName.includes('서버')) {
        type = '서버포함';
    }

    let gpuMultiplier = 1;
    let needReview = false;
    if (type === '서버포함') {
        // 감토패턴: 자동 추정 금지 (장착 가능 수량이므로)
        let isReviewOnly = /UP\s*TO\s*\d+\s*GPU|GPU[\s-]*READY|PCIE\s*SLOT\s*FOR\s*GPU/i.test(fullText);
        if (isReviewOnly) {
            gpuMultiplier = 1; needReview = true; reviewCount++;
        } else {
            // 강한패턴: 엑셀 규칙과 동일 (16/12/8/6/4/2/1개 지원)
            let m = fullText.match(/(\d+)\s*[*x×]\s*(?:GPU|NVIDIA|NV)/i) ||
                    fullText.match(/(\d+)\s*EA\s*(?:GPU|NVIDIA)?/i) ||
                    fullText.match(/(\d+)[-]GPU/i) ||
                    fullText.match(/(\d+)\s*GPU/i) ||
                    fullText.match(/(\d+)개\s*(?:장착|탑재)/i);
            if (m) {
                let cnt = parseInt(m[1]);
                if (cnt >= 1 && cnt <= 16) gpuMultiplier = cnt;
                else { gpuMultiplier = 1; needReview = true; reviewCount++; }
            } else {
                gpuMultiplier = 1; needReview = true; reviewCount++;
            }
        }
    }
    let realQty = qty * gpuMultiplier;

    processedItems.push({
        source: 'GPU', id: row['신청번호'] || 'N/A', year,
        empNo: row['신청자개인번호'] || '00000', empName: row['신청자'] || '미상', dept: row['신청부서'] || '공통',
        title: itemName, qty: realQty, qtySingle: type === 'GPU단품' ? realQty : 0, qtyServer: type === '서버포함' ? realQty : 0,
        amt, series, manufacturer, subModel, type, excluded: false, needReview,
        matchKeyword, matchCol,
        rawMemo: (row['적요'] || '').substring(0, 120),
        rawClob: (row['STD_CLOB'] || '').substring(0, 120)
    });
});

// 2. NPU 분석 연산
rawNpuData.forEach(row => {
    let amt = safeParseInt(row['총금액(원)'] || row['추정금액']);
    let qty = safeParseInt(row['수량'] || row['물품수량'], 1);
    let dateStr = (row['신청연도'] || row['신청일'] || '').toString();
    let year = parseInt(dateStr.substring(0, 4)) || 2024;

    if (!row['물품명'] && !row['신청번호']) return;
    if (year < startYear || year > endYear) return;
    if (amt < minAmount) return;

    let originType = (row['국산여부'] || '').toString().trim();
    let firm = (row['제조사'] || '').toString().trim();
    let cat = (row['카테고리'] || '').toString();
    let name = (row['물품명'] || '').toString();
    let model = (row['모델'] || '-').toString();
    let clob = (row['STD_CLOB'] || '').toString();
    let memo = (row['적요'] || row['비고'] || '').toString();

    // 물품명 + STD_CLOB + 적요/비고 + 제조사 모두 합쳐서 매칭
    let combinedText = (name + ' ' + clob + ' ' + memo + ' ' + firm).toUpperCase();

    let mappingOrigin = '기타';
    if (originType === '국산') mappingOrigin = '국산 하드웨어';
    else if (originType === '외산') mappingOrigin = '외산 하드웨어';
    else if (originType === '용역') mappingOrigin = '연구용역';

    // 국산 NPU 기업 목록
    const domesticFirms = ['FURIOSA', 'REBELLIONS', 'REBEL', 'DEEPX', 'MOBILINT', 'MOBIL', 'AIM', 'SAPEON', 'ATOM', 'SEMIPIA', '세미피아', 'OPENEDGES', '오픈엣지', 'ENLIGHT', '엔라이텐', 'MOREH', '모레', 'NOTA', '노타', 'NEOWIZ', 'SUPERB', '슈퍼브', 'GAONCHIPS', '가온칩스', 'TELECHIPS', '텔레칩스', 'ETRI'];
    // 외산 NPU 기업 목록
    const foreignFirms = ['HAILO', 'NVIDIA', 'INTEL', 'ROCKCHIP', 'RASPBERRY', 'QUALCOMM', 'AMD', 'XILINX', 'GOOGLE', 'GRAPHCORE', 'CEREBRAS', 'SAMBANOVA', 'GROQ', 'FPGA', 'APPLE', 'AWS', 'AMAZON'];

    if (originType === '용역') {
        firm = '연구용역';
    } else {
        // combinedText(물품명+STD_CLOB+적요+제조사)에서 키워드 매칭
        if (combinedText.includes('FURIOSA') || combinedText.includes('퓨리오사')) firm = 'FuriosaAI';
        else if (combinedText.includes('REBELLIONS') || combinedText.includes('리벨리온') || combinedText.includes('REBEL')) firm = 'Rebellions';
        else if (combinedText.includes('DEEPX') || combinedText.includes('딥엑스')) firm = 'DeepX';
        else if (combinedText.includes('MOBILINT') || combinedText.includes('MOIBILINT') || combinedText.includes('MOBILONT') || combinedText.includes('MOBIL INT') || combinedText.includes('모빌린트') || combinedText.includes('모빌린')) firm = 'Mobilint';
        else if (combinedText.includes('SAPEON') || combinedText.includes('사피온')) firm = 'SAPEON';
        else if (combinedText.includes('ATOM') || combinedText.includes('아톰')) firm = 'ATOM';
        else if (combinedText.includes('SEMIPIA') || combinedText.includes('세미피아')) firm = 'Semipia';
        else if (combinedText.includes('OPENEDGES') || combinedText.includes('오픈엣지')) firm = 'OpenEdges';
        else if (combinedText.includes('GAONCHIPS') || combinedText.includes('가온칩스')) firm = 'GaonChips';
        else if (combinedText.includes('TELECHIPS') || combinedText.includes('텔레칩스')) firm = 'TeleChips';
        else if (combinedText.includes('AIM')) firm = 'AiM';
        else if (combinedText.includes('HAILO')) firm = 'Hailo';
        else if (combinedText.includes('NVIDIA')) firm = 'NVIDIA';
        else if (combinedText.includes('INTEL')) firm = 'Intel';
        else if (combinedText.includes('ROCKCHIP')) firm = 'Rockchip';
        else if (combinedText.includes('RASPBERRY')) firm = 'Raspberry Pi';
        else if (combinedText.includes('QUALCOMM')) firm = 'Qualcomm';
        else if (combinedText.includes('AMD')) firm = 'AMD';
        else if (combinedText.includes('XILINX')) firm = 'Xilinx';
        else if (combinedText.includes('GRAPHCORE')) firm = 'Graphcore';
        else if (combinedText.includes('FPGA')) firm = 'FPGA IP';
        else firm = firm || '기타';
    }

    // 국산/외산 자동 판별 보강 (CSV에 국산여부 없을 경우 기업명 + 전체 텍스트로 추론)
    if (mappingOrigin === '기타' && originType !== '용역') {
        if (domesticFirms.some(d => combinedText.includes(d))) mappingOrigin = '국산 하드웨어';
        else if (foreignFirms.some(f => combinedText.includes(f))) mappingOrigin = '외산 하드웨어';
    }

    let type = 'GPU단품';
    if (cat.includes('서버') || name.toUpperCase().includes('SERVER')) type = '서버포함';

    processedItems.push({
        source: 'NPU', id: row['신청번호'] || 'N/A', year,
        empNo: 'NPU-DATA', empName: row['신청자'] || '연구담당', dept: row['신청부서'] || '연구부서',
        title: name, qty: qty, qtySingle: type === 'GPU단품' ? qty : 0, qtyServer: type === '서버포함' ? qty : 0,
        amt, series: 'NPU', subModel: model, manufacturer: firm, type,
        excluded: false, needReview: false, npuOrigin: mappingOrigin, npuFirm: firm
    });
});

updateMetrics(reviewCount, exclusionCount);
renderSeriesSummaryTable();
renderGpuModelTable();
renderNpuTabsData();
renderNpuCharts();
renderEmpTable();
renderRawTable();
renderExAndReviewTables();
renderCharts();
}

function updateMetrics(reviewCount, exclusionCount) {
let active = processedItems.filter(i => !i.excluded);
let totalAmt = active.reduce((acc, i) => acc + i.amt, 0);
let totalQty = active.reduce((acc, i) => acc + i.qty, 0);

document.getElementById('cardTotalAmount').innerText = totalAmt.toLocaleString() + ' 원';
document.getElementById('cardTotalQty').innerText = totalQty.toLocaleString() + ' 개';
document.getElementById('cardTotalCount').innerText = active.length.toLocaleString() + ' 건';
document.getElementById('cardReviewExCount').innerText = `${reviewCount} / ${exclusionCount} 건`;
}

function renderSeriesSummaryTable() {
let active = processedItems.filter(i => !i.excluded);
let totalAmtAll = active.reduce((acc, i) => acc + i.amt, 0);

let summaryMap = {};
seriesOrder.forEach(s => { summaryMap[s] = { count: 0, singleQty: 0, serverQty: 0, totalQty: 0, totalAmt: 0 }; });

active.forEach(item => {
    let s = item.series;
    if (!summaryMap[s]) s = '기타';
    summaryMap[s].count++;
    summaryMap[s].singleQty += item.qtySingle;
    summaryMap[s].serverQty += item.qtyServer;
    summaryMap[s].totalQty += item.qty;
    summaryMap[s].totalAmt += item.amt;
});

let html = '';
seriesOrder.forEach(s => {
    let data = summaryMap[s];
    let weight = totalAmtAll > 0 ? ((data.totalAmt / totalAmtAll) * 100).toFixed(1) + '%' : '-';
    let avgPerGpu = data.totalQty > 0 ? Math.round(data.totalAmt / data.totalQty).toLocaleString() : '-';
    html += `
        <tr class="hover:bg-slate-50 transition">
            <td class="p-2.5 font-bold text-slate-800">${s}</td>
            <td class="p-2.5 text-right">${data.count.toLocaleString()}</td>
            <td class="p-2.5 text-right text-slate-400">${data.singleQty.toLocaleString()}</td>
            <td class="p-2.5 text-right text-slate-400">${data.serverQty.toLocaleString()}</td>
            <td class="p-2.5 text-right text-blue-600 font-bold clickable-qty" onclick="showSeriesDetail('${s}')" title="클릭하면 ${s} 상세 내역 확인">${data.totalQty.toLocaleString()}</td>
            <td class="p-2.5 text-right text-slate-700 font-semibold">${data.totalAmt.toLocaleString()}</td>
            <td class="p-2.5 text-right text-slate-500">${avgPerGpu}</td>
            <td class="p-2.5 text-right text-slate-500 font-medium">${weight}</td>
        </tr>
    `;
});
document.getElementById('seriesTableBody').innerHTML = html;

// 연도별 시리즈별 수량 추이 테이블
let startYear = parseInt(document.getElementById('startYear').value) || 2020;
let endYear = parseInt(document.getElementById('endYear').value) || 2026;
let years = [];
for (let y = endYear; y >= startYear; y--) years.push(y);

// GPU 시리즈 순서 (NPU 제외)
let gpuSeriesOrder = seriesOrder.filter(s => s !== 'NPU');
let yearSeriesMap = {};
years.forEach(y => {
    yearSeriesMap[y] = {};
    gpuSeriesOrder.forEach(s => yearSeriesMap[y][s] = 0);
});
active.forEach(item => {
    if (item.source !== 'GPU') return;
    let yIdx = years.indexOf(item.year);
    if (yIdx === -1) return;
    let s = item.series;
    if (yearSeriesMap[item.year][s] === undefined) s = '기타';
    yearSeriesMap[item.year][s] += item.qty;
});

let yearlySeriesHtml = '';
years.forEach(y => {
    let rowTotal = gpuSeriesOrder.reduce((sum, s) => sum + yearSeriesMap[y][s], 0);
    yearlySeriesHtml += `<tr class="hover:bg-slate-50">
        <td class="p-2.5 font-bold text-slate-800">${y}</td>
        ${gpuSeriesOrder.map(s => `<td class="p-2.5 text-right">${(yearSeriesMap[y][s] || 0).toLocaleString()}</td>`).join('')}
        <td class="p-2.5 text-right font-extrabold text-slate-900">${rowTotal.toLocaleString()}</td>
    </tr>`;
});
document.getElementById('yearlySeriesTableBody').innerHTML = yearlySeriesHtml || '<tr><td colspan="9" class="p-4 text-center text-slate-400">데이터가 없습니다.</td></tr>';

// 연도별 도입형태별 요약 테이블
let yearTypeMap = {};
years.forEach(y => yearTypeMap[y] = { single: 0, server: 0, total: 0, count: 0 });
active.forEach(item => {
    let yIdx = years.indexOf(item.year);
    if (yIdx === -1) return;
    yearTypeMap[item.year].single += item.qtySingle;
    yearTypeMap[item.year].server += item.qtyServer;
    yearTypeMap[item.year].total += item.qty;
    yearTypeMap[item.year].count++;
});

let yearlyTypeHtml = '';
years.forEach(y => {
    let d = yearTypeMap[y];
    yearlyTypeHtml += `<tr class="hover:bg-slate-50">
        <td class="p-2.5 font-bold text-slate-800">${y}</td>
        <td class="p-2.5 text-right">${d.single.toLocaleString()}</td>
        <td class="p-2.5 text-right">${d.server.toLocaleString()}</td>
        <td class="p-2.5 text-right font-extrabold text-slate-900">${d.total.toLocaleString()}</td>
        <td class="p-2.5 text-right text-slate-500">${d.count}</td>
    </tr>`;
});
document.getElementById('yearlyTypeTableBody').innerHTML = yearlyTypeHtml || '<tr><td colspan="5" class="p-4 text-center text-slate-400">데이터가 없습니다.</td></tr>';
}

function renderGpuModelTable() {
let activeGpu = processedItems.filter(i => !i.excluded && i.source === 'GPU');
let totalGpuAmt = activeGpu.reduce((s,i) => s + i.amt, 0);

// 세부 모델별 집계
let modelMap = {};
activeGpu.forEach(item => {
    let k = item.series + '||' + item.subModel;
    if (!modelMap[k]) modelMap[k] = { series: item.series, model: item.subModel, count: 0, qty: 0, amt: 0 };
    modelMap[k].count++;
    modelMap[k].qty += item.qty;
    modelMap[k].amt += item.amt;
});
let sortedModels = Object.values(modelMap).sort((a, b) => seriesOrder.indexOf(a.series) - seriesOrder.indexOf(b.series) || b.qty - a.qty);
document.getElementById('gpuModelTableBody').innerHTML = sortedModels.map(m => `
    <tr class="hover:bg-slate-50">
        <td class="p-3 text-slate-400 font-medium">${m.series}</td>
        <td class="p-3 font-semibold text-slate-800">${m.model}</td>
        <td class="p-3 text-right">${m.count}</td>
        <td class="p-3 text-right text-blue-600 font-bold">${m.qty.toLocaleString()}</td>
        <td class="p-3 text-right text-slate-600 font-medium">${m.amt.toLocaleString()}</td>
    </tr>
`).join('') || '<tr><td colspan="5" class="p-4 text-center text-slate-400">데이터가 없습니다.</td></tr>';

// 제조사(벤더)별 집계
let vendorMap = {};
activeGpu.forEach(item => {
    let v = item.manufacturer;
    if (!vendorMap[v]) vendorMap[v] = { name: v, count: 0, qty: 0, amt: 0 };
    vendorMap[v].count++;
    vendorMap[v].qty += item.qty;
    vendorMap[v].amt += item.amt;
});
let sortedVendors = Object.values(vendorMap).sort((a,b) => {
    if (a.name === '기타') return 1;
    if (b.name === '기타') return -1;
    return b.amt - a.amt;
});
document.getElementById('gpuVendorTableBody').innerHTML = sortedVendors.map(v => {
    let pct = totalGpuAmt > 0 ? ((v.amt / totalGpuAmt) * 100).toFixed(1) + '%' : '-';
    return `<tr class="hover:bg-slate-50">
        <td class="p-3 font-bold text-slate-800">${v.name}</td>
        <td class="p-3 text-right">${v.count}</td>
        <td class="p-3 text-right text-blue-600 font-bold">${v.qty.toLocaleString()}</td>
        <td class="p-3 text-right text-slate-600 font-medium">${v.amt.toLocaleString()}</td>
        <td class="p-3 text-right text-slate-500">${pct}</td>
    </tr>`;
}).join('') || '<tr><td colspan="5" class="p-4 text-center text-slate-400">데이터가 없습니다.</td></tr>';
}

// NPU 기업별 국산/외산 자동 판별 함수
function getFirmOriginType(firmName) {
const domestic = ['FuriosaAI', 'Rebellions', 'DeepX', 'Mobilint', 'AiM', 'SAPEON', 'ATOM', 'Semipia', 'OpenEdges', 'GaonChips', 'TeleChips'];
const foreign = ['Hailo', 'NVIDIA', 'Intel', 'Rockchip', 'Raspberry Pi', 'Qualcomm', 'AMD', 'Xilinx', 'Graphcore', 'FPGA IP'];
if (domestic.some(d => firmName.includes(d))) return '국산';
if (foreign.some(f => firmName.includes(f))) return '외산';
if (firmName === '연구용역') return '용역';
return '기타';
}

function getOriginBadge(type) {
if (type === '국산') return '<span class="badge-domestic">국산</span>';
if (type === '외산') return '<span class="badge-foreign">외산</span>';
if (type === '용역') return '<span class="badge-service">용역</span>';
return '<span class="bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full text-[10px] font-bold">기타</span>';
}

function renderNpuTabsData() {
let activeNpu = processedItems.filter(i => !i.excluded && i.source === 'NPU');

let originMap = {
    '국산 하드웨어': { c:0, q:0, a:0 },
    '외산 하드웨어': { c:0, q:0, a:0 },
    '연구용역': { c:0, q:0, a:0 },
    '기타': { c:0, q:0, a:0 }
};
let firmMap = {};

activeNpu.forEach(item => {
    let ori = item.npuOrigin || '기타';
    if (originMap[ori]) {
        originMap[ori].c++;
        originMap[ori].q += item.qty;
        originMap[ori].a += item.amt;
    }
    let f = item.npuFirm || '기타';
    if (!firmMap[f]) firmMap[f] = { name: f, c:0, q:0, a:0, origin: getFirmOriginType(f) };
    firmMap[f].c++;
    firmMap[f].q += item.qty;
    firmMap[f].a += item.amt;
});

let totalNpuAmt = activeNpu.reduce((s,i) => s + i.amt, 0);

// 요약 카드 업데이트
let dom = originMap['국산 하드웨어'];
let fgn = originMap['외산 하드웨어'];
let svc = originMap['연구용역'];
document.getElementById('npuDomesticAmt').innerText = dom.a.toLocaleString() + ' 원';
document.getElementById('npuDomesticQty').innerText = dom.q.toLocaleString() + '개 / ' + dom.c + '건';
document.getElementById('npuForeignAmt').innerText = fgn.a.toLocaleString() + ' 원';
document.getElementById('npuForeignQty').innerText = fgn.q.toLocaleString() + '개 / ' + fgn.c + '건';
document.getElementById('npuServiceAmt').innerText = svc.a.toLocaleString() + ' 원';
document.getElementById('npuServiceQty').innerText = svc.q.toLocaleString() + '개 / ' + svc.c + '건';

// 구분별 요약 테이블 (비중 포함)
const originIcons = {};
let originOrder = ['국산 하드웨어', '외산 하드웨어', '연구용역', '기타'];
document.getElementById('npuOriginTableBody').innerHTML = originOrder.map(k => {
    let d = originMap[k];
    let pct = totalNpuAmt > 0 ? ((d.a / totalNpuAmt) * 100).toFixed(1) + '%' : '0%';
    return `<tr class="hover:bg-slate-50">
        <td class="p-3 font-bold text-slate-700">${k}</td>
        <td class="p-3 text-right">${d.c} 건</td>
        <td class="p-3 text-right text-blue-600 font-bold">${d.q.toLocaleString()}</td>
        <td class="p-3 text-right text-slate-600 font-semibold">${d.a.toLocaleString()}</td>
        <td class="p-3 text-right text-slate-500 font-medium">${pct}</td>
    </tr>`;
}).join('');

// 제조사별 테이블 (국산/외산 배지 포함)
let sortedFirms = Object.values(firmMap).sort((a,b) => {
    if (a.name === '기타') return 1;
    if (b.name === '기타') return -1;
    if (a.origin === '국산' && b.origin !== '국산') return -1;
    if (a.origin !== '국산' && b.origin === '국산') return 1;
    return b.a - a.a;
});
document.getElementById('npuFirmTableBody').innerHTML = sortedFirms.map(f => `
    <tr class="hover:bg-slate-50">
        <td class="p-3 font-bold text-slate-800">${f.name}</td>
        <td class="p-3">${getOriginBadge(f.origin)}</td>
        <td class="p-3 text-right">${f.c} 건</td>
        <td class="p-3 text-right text-blue-600 font-bold">${f.q.toLocaleString()}</td>
        <td class="p-3 text-right text-slate-600">${f.a.toLocaleString()}</td>
    </tr>
`).join('') || '<tr><td colspan="5" class="p-3 text-center text-slate-400">데이터가 없습니다.</td></tr>';

// 국산 상세 내역 테이블
let domesticItems = activeNpu.filter(i => i.npuOrigin === '국산 하드웨어').sort((a,b) => a.npuFirm.localeCompare(b.npuFirm) || b.amt - a.amt);
document.getElementById('npuDomesticDetailBody').innerHTML = domesticItems.map(i => `
    <tr class="hover:bg-blue-50/30">
        <td class="p-3 font-bold text-blue-700">${i.npuFirm}</td>
        <td class="p-3 text-slate-700 max-w-xs truncate" title="${i.title}">${i.title}</td>
        <td class="p-3 text-slate-500">${i.subModel}</td>
        <td class="p-3 text-right font-bold">${i.qty}</td>
        <td class="p-3 text-right font-medium">${i.amt.toLocaleString()}</td>
        <td class="p-3 text-slate-400">${i.year}</td>
    </tr>
`).join('') || '<tr><td colspan="6" class="p-3 text-center text-slate-400">국산 NPU 도입 내역이 없습니다.</td></tr>';

// 외산 상세 내역 테이블
let foreignItems = activeNpu.filter(i => i.npuOrigin === '외산 하드웨어').sort((a,b) => a.npuFirm.localeCompare(b.npuFirm) || b.amt - a.amt);
document.getElementById('npuForeignDetailBody').innerHTML = foreignItems.map(i => `
    <tr class="hover:bg-pink-50/30">
        <td class="p-3 font-bold text-pink-700">${i.npuFirm}</td>
        <td class="p-3 text-slate-700 max-w-xs truncate" title="${i.title}">${i.title}</td>
        <td class="p-3 text-slate-500">${i.subModel}</td>
        <td class="p-3 text-right font-bold">${i.qty}</td>
        <td class="p-3 text-right font-medium">${i.amt.toLocaleString()}</td>
        <td class="p-3 text-slate-400">${i.year}</td>
    </tr>
`).join('') || '<tr><td colspan="6" class="p-3 text-center text-slate-400">외산 NPU 도입 내역이 없습니다.</td></tr>';
}

let npuOriginChartInstance = null;
let npuFirmBarChartInstance = null;

function renderNpuCharts() {
if (typeof Chart === 'undefined') return;
let activeNpu = processedItems.filter(i => !i.excluded && i.source === 'NPU');

let domAmt = 0, fgnAmt = 0, svcAmt = 0;
activeNpu.forEach(i => {
    if (i.npuOrigin === '국산 하드웨어') domAmt += i.amt;
    else if (i.npuOrigin === '외산 하드웨어') fgnAmt += i.amt;
    else if (i.npuOrigin === '연구용역') svcAmt += i.amt;
});

try {
    // 국산/외산 비율 도넛 차트
    if (npuOriginChartInstance) npuOriginChartInstance.destroy();
    npuOriginChartInstance = new Chart(document.getElementById('chartNpuOriginPie').getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: ['국산', '외산', '용역'],
            datasets: [{ data: [domAmt, fgnAmt, svcAmt], backgroundColor: ['#3b82f6', '#ec4899', '#8b5cf6'], borderColor: ['#2563eb', '#db2777', '#7c3aed'], borderWidth: 2 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { family: 'Pretendard', size: 11 } } } } }
    });

    // 제조사별 투자 바 차트 (기타 제외)
    let firmMap = {};
    activeNpu.forEach(i => {
        let f = i.npuFirm || '기타';
        if (f === '연구용역' || f === '기타') return;
        if (!firmMap[f]) firmMap[f] = { amt: 0, origin: getFirmOriginType(f) };
        firmMap[f].amt += i.amt;
    });
    let sortedFirms = Object.entries(firmMap).sort((a,b) => b[1].amt - a[1].amt);
    let firmLabels = sortedFirms.map(e => e[0]);
    let firmAmts = sortedFirms.map(e => e[1].amt);
    let firmColors = sortedFirms.map(e => e[1].origin === '국산' ? '#3b82f6' : '#ec4899');

    if (npuFirmBarChartInstance) npuFirmBarChartInstance.destroy();
    npuFirmBarChartInstance = new Chart(document.getElementById('chartNpuFirmBar').getContext('2d'), {
        type: 'bar',
        data: { labels: firmLabels, datasets: [{ label: '투자 금액', data: firmAmts, backgroundColor: firmColors, borderColor: firmColors.map(c => c), borderWidth: 1 }] },
        options: {
            responsive: true, maintainAspectRatio: false, indexAxis: 'y',
            scales: { x: { ticks: { callback: v => (v / 100000000).toFixed(1) + '억', font: { family: 'Pretendard' } } } },
            plugins: { legend: { display: false } }
        }
    });
} catch(e) { console.log('NPU 차트 예외:', e); }
}

function renderEmpTable() {
let query = document.getElementById('empSearch').value.toLowerCase();
let active = processedItems.filter(i => !i.excluded);

let empMap = {};
active.forEach(item => {
    let key = item.empNo;
    if (!empMap[key]) { empMap[key] = { empNo: item.empNo, name: item.empName, dept: item.dept, qty: 0, amt: 0 }; }
    empMap[key].qty += item.qty;
    empMap[key].amt += item.amt;
});

let list = Object.values(empMap).filter(e => e.name.toLowerCase().includes(query) || e.dept.toLowerCase().includes(query));
list.sort((a, b) => b.qty - a.qty);

document.getElementById('empTableBody').innerHTML = list.map(e => `
    <tr class="hover:bg-slate-50">
        <td class="p-3 text-slate-400 font-mono">${e.empNo}</td>
        <td class="p-3 font-bold text-slate-800">${e.name}</td>
        <td class="p-3 text-slate-500">${e.dept}</td>
        <td class="p-3 text-right text-blue-600 font-bold">${e.qty.toLocaleString()}</td>
        <td class="p-3 text-right text-slate-700 font-semibold">${e.amt.toLocaleString()}</td>
    </tr>
`).join('') || '<tr><td colspan="5" class="p-4 text-center text-slate-400">일치 내역이 없습니다.</td></tr>';
}

function renderRawTable() {
let query = document.getElementById('rawSearch').value.toLowerCase();
let active = processedItems.filter(i => !i.excluded);

if (query) {
    active = active.filter(i => i.id.toLowerCase().includes(query) || i.title.toLowerCase().includes(query) || i.empName.toLowerCase().includes(query));
}

let html = active.slice(0, 300).map(i => `
    <tr class="hover:bg-slate-50 text-slate-600">
        <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${i.source === 'GPU' ? 'bg-slate-100 text-slate-700':'bg-slate-200 text-slate-800'}">${i.source}</span></td>
        <td class="p-3 font-mono text-slate-400">${i.id}</td>
        <td class="p-3 font-semibold">${i.year}</td>
        <td class="p-3 text-slate-700">${i.empName}<span class="text-slate-400 text-[10px] block">${i.dept}</span></td>
        <td class="p-3 font-medium text-slate-800 max-w-xs truncate" title="${i.title}">${i.title}</td>
        <td class="p-3 text-right font-bold text-slate-900">${i.qty}</td>
        <td class="p-3 text-right font-medium">${i.amt.toLocaleString()}</td>
        <td class="p-3"><span class="bg-slate-100 px-2 py-0.5 rounded text-[10px] font-bold text-slate-600">${i.series}</span></td>
        <td class="p-3 text-xs text-slate-400">${i.type}</td>
    </tr>
`).join('');

if (active.length > 300) {
    html += `<tr><td colspan="9" class="p-3 bg-slate-50 text-slate-500 text-center text-xs font-semibold">상위 300건만 요약 출력되었습니다. 전체 지표 계산에는 완벽히 도합되었습니다.</td></tr>`;
}
document.getElementById('rawTableBody').innerHTML = html || '<tr><td colspan="9" class="p-4 text-center">조건에 만족하는 자산 내역이 존재하지 않습니다.</td></tr>';
}

function renderExAndReviewTables() {
let exclusions = processedItems.filter(i => i.excluded);
let reviews = processedItems.filter(i => !i.excluded && i.needReview);

document.getElementById('exTableBody').innerHTML = exclusions.map(i => {
    let badgeClass = '';
    let badgeLabel = i.exReason || '미상';
    if (badgeLabel.includes('부속품')) badgeClass = 'bg-amber-100 text-amber-700 border border-amber-200';
    else if (badgeLabel.includes('구매속성')) badgeClass = 'bg-rose-100 text-rose-700 border border-rose-200';
    else badgeClass = 'bg-slate-100 text-slate-600 border border-slate-200';
    // 괄호 안 키워드 추출
    let kwMatch = badgeLabel.match(/\(([^)]+)\)/);
    let kw = kwMatch ? kwMatch[1] : '';
    let reason = badgeLabel.replace(/\s*\([^)]+\)/, '');
    return `
    <tr class="hover:bg-slate-50">
        <td class="p-3 font-mono text-slate-400 text-[11px]">${i.id}</td>
        <td class="p-3 text-slate-700 max-w-[200px] truncate" title="${(i.title || '').replace(/"/g, '&quot;')}">${i.title}</td>
        <td class="p-3 text-right font-medium">${i.amt.toLocaleString()}</td>
        <td class="p-3">
            <span class="${badgeClass} px-2 py-0.5 rounded-full text-[10px] font-bold">${reason}</span>
            ${kw ? ` <span class="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded text-[10px] font-bold">${kw}</span>` : ''}
        </td>
    </tr>`;
}).join('') || '<tr><td colspan="4" class="p-3 text-center text-slate-300">규칙 제외 이력이 발견되지 않았습니다.</td></tr>';

document.getElementById('reviewTableBody').innerHTML = reviews.map(i => {
    let memoSnippet = (i.rawMemo || '').substring(0, 80) || '-';
    let clobSnippet = (i.rawClob || '').substring(0, 80) || '-';
    let previewText = memoSnippet !== '-' ? memoSnippet : clobSnippet;
    return `
    <tr class="hover:bg-amber-50/50">
        <td class="p-3 font-mono text-slate-400 text-[11px]">${i.id}</td>
        <td class="p-3 text-slate-700 max-w-[180px] truncate" title="${(i.title || '').replace(/"/g, '&quot;')}">${i.title}</td>
        <td class="p-3 text-right font-medium">${i.amt.toLocaleString()}</td>
        <td class="p-3">
            <span class="bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full text-[10px] font-bold">GPU배수 미감지</span>
            <span class="bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded text-[10px] font-bold">×1 적용</span>
        </td>
        <td class="p-3 text-slate-400 text-[10px] max-w-[250px] truncate" title="적요: ${memoSnippet} / STD_CLOB: ${clobSnippet}">${previewText}</td>
    </tr>`;
}).join('') || '<tr><td colspan="5" class="p-3 text-center text-slate-300">수동 보정 검토 대상 이력이 존재하지 않습니다.</td></tr>';
}

function renderCharts() {
if (typeof Chart === 'undefined') {
    document.getElementById('pieFallback').classList.remove('hidden');
    return;
}

let active = processedItems.filter(i => !i.excluded);
let amtMap = {};
seriesOrder.forEach(s => amtMap[s] = 0);
active.forEach(i => { if (amtMap[i.series] !== undefined) amtMap[i.series] += i.amt; else amtMap['기타'] += i.amt; });

try {
    if (pieChartInstance) pieChartInstance.destroy();
    pieChartInstance = new Chart(document.getElementById('chartPie').getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: seriesOrder,
            datasets: [{
                data: seriesOrder.map(s => amtMap[s]),
                backgroundColor: seriesColors,
                borderColor: '#ffffff',
                borderWidth: 3,
                hoverBorderColor: '#ffffff',
                hoverBorderWidth: 4,
                hoverOffset: 12,
                spacing: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '55%',
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        boxWidth: 12,
                        boxHeight: 12,
                        borderRadius: 3,
                        useBorderRadius: true,
                        padding: 12,
                        font: { family: 'Pretendard', size: 11, weight: '600' },
                        color: '#334155'
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15,23,42,0.9)',
                    titleFont: { family: 'Pretendard', size: 12, weight: '700' },
                    bodyFont: { family: 'Pretendard', size: 11 },
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(ctx) {
                            let total = ctx.dataset.data.reduce((a,b) => a+b, 0);
                            let pct = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : 0;
                            return ctx.label + ': ' + ctx.raw.toLocaleString() + '원 (' + pct + '%)';
                        }
                    }
                }
            },
            animation: { animateRotate: true, animateScale: true, duration: 800 }
        }
    });
} catch (e) {
    console.log("시각화 스크립트 예외 제어:", e);
}
}



function showSeriesDetail(seriesName) {
    let items = processedItems.filter(i => !i.excluded && i.series === seriesName);
    items.sort((a, b) => b.year - a.year || b.amt - a.amt);

    let totalQty = items.reduce((s, i) => s + i.qty, 0);
    let totalAmt = items.reduce((s, i) => s + i.amt, 0);

    document.getElementById('modalTitle').textContent = seriesName + ' 집계 대상 원본 내역';
    document.getElementById('modalSubtitle').textContent = `총 ${items.length}건 / GPU ${totalQty.toLocaleString()}개 / ${totalAmt.toLocaleString()}원`;

    document.getElementById('modalTableBody').innerHTML = items.map(i => {
        let reasonHtml = '';
        if (i.matchKeyword && i.matchKeyword !== '-') {
            let colBadge = i.matchCol === '물품명' ? 'bg-blue-100 text-blue-700' : i.matchCol === '적요' ? 'bg-amber-100 text-amber-700' : i.matchCol === 'STD_CLOB' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-500';
            let tooltipText = i.matchCol === '적요' ? (i.rawMemo || '') : i.matchCol === 'STD_CLOB' ? (i.rawClob || '') : (i.title || '');
            reasonHtml = `<span class="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded text-[10px] font-bold">${i.matchKeyword}</span> <span class="${colBadge} px-1 py-0.5 rounded text-[9px] font-semibold cursor-help" title="${tooltipText.replace(/"/g, '&quot;')}">${i.matchCol}</span>`;
        } else {
            reasonHtml = '<span class="text-slate-300 text-[10px]">미매칭</span>';
        }
        return `
        <tr class="hover:bg-blue-50/40 transition">
            <td class="p-2.5 text-slate-400 font-mono text-[11px]">${i.id}</td>
            <td class="p-2.5 font-semibold">${i.year}</td>
            <td class="p-2.5 text-slate-700 max-w-[220px] truncate" title="${(i.title || '').replace(/"/g, '&quot;')}">${i.title || '-'}</td>
            <td class="p-2.5"><span class="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[10px] font-bold">${i.subModel || '-'}</span></td>
            <td class="p-2.5 text-slate-500">${i.manufacturer || '-'}</td>
            <td class="p-2.5"><span class="${i.type === '서버포함' ? 'text-violet-600' : 'text-emerald-600'} font-semibold text-[10px]">${i.type}</span></td>
            <td class="p-2.5 text-right font-bold text-blue-600">${i.qty.toLocaleString()}</td>
            <td class="p-2.5 text-right font-medium text-slate-600">${i.amt.toLocaleString()}</td>
            <td class="p-2.5">${reasonHtml}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="9" class="p-6 text-center text-slate-400">해당 시리즈 데이터가 없습니다.</td></tr>';

    let typeSummary = {};
    items.forEach(i => {
        if (!typeSummary[i.type]) typeSummary[i.type] = { count: 0, qty: 0 };
        typeSummary[i.type].count++;
        typeSummary[i.type].qty += i.qty;
    });
    document.getElementById('modalFooter').innerHTML = Object.entries(typeSummary).map(([k, v]) => `${k}: ${v.count}건 (GPU ${v.qty.toLocaleString()}개)`).join(' &middot; ');

    document.getElementById('seriesModal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeSeriesModal() {
    document.getElementById('seriesModal').classList.remove('active');
    document.body.style.overflow = '';
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSeriesModal(); });
