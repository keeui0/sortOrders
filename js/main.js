let combinedData = {};
let currentGameData = [];
let overallChartInstance = null;
let rawGoogleData = null;
let rawAppleData = null;
let selectedYear = 'all';
let appMode = 'all'; // 'all', 'google', 'apple'
let autoAppliedPublishers = []; // 업로드 직후 자동 분류된 퍼블리셔 그룹 이름

// 날짜를 'YYYY-MM-DD' 형식의 문자열로 변환 (현지 시간대 기준)
function getLocalDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function setupFileInputListeners() {
    const googleFileInput = document.getElementById('googleFileInput');
    const appleFileInput = document.getElementById('appleFileInput');

    if (googleFileInput) {
        googleFileInput.addEventListener('change', (event) => handleFileUpload(event, 'google'));
    }
    if (appleFileInput) {
        appleFileInput.addEventListener('change', (event) => handleFileUpload(event, 'apple'));
    }
}

function handleFileUpload(event, type) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const fileContent = e.target.result;
            let newData;
            let statusElementId = type === 'google' ? 'googleFileStatus' : 'appleFileStatus';
            let statusElement = document.getElementById(statusElementId);

            if (type === 'google' && file.name.endsWith('.json')) {
                rawGoogleData = JSON.parse(fileContent);
                if (statusElement) statusElement.textContent = `✅ ${file.name} 로드됨`;
            } else if (type === 'apple' && (file.name.endsWith('.html') || file.name.endsWith('.htm'))) {
                const parser = new DOMParser();
                rawAppleData = parser.parseFromString(fileContent, "text/html");
                if (statusElement) statusElement.textContent = `✅ ${file.name} 로드됨`;
            } else {
                alert('잘못된 파일 형식입니다. .json 또는 .html 파일을 업로드해주세요.');
                event.target.value = '';
                return;
            }
            
            reprocessAllData();
            // 퍼블리셔 기반 후보는 신뢰도가 높아 업로드 직후 자동 분류하고 결과를 바로 보여준다.
            if (autoApplyPublisherKeywords() > 0) reprocessAllData();

        } catch (error) {
            alert('파일을 처리하는 중 오류가 발생했습니다. 파일 형식이 올바른지 확인해주세요.');
            console.error("파일 처리 오류:", error);
        }
    };
    reader.readAsText(file, 'UTF-8');
}

function reprocessAllData() {
    combinedData = {};
    if (rawGoogleData) {
        // 진단: 업로드된 Google JSON의 최상위 구조 노출
        console.info('[reprocess] rawGoogleData type:', Array.isArray(rawGoogleData) ? `Array(${rawGoogleData.length})` : typeof rawGoogleData);
        if (!Array.isArray(rawGoogleData)) {
            console.info('[reprocess] rawGoogleData keys:', Object.keys(rawGoogleData));
        }
        const googleData = parseGoogleData(rawGoogleData);
        mergeData(googleData);
    }
    if (rawAppleData) {
        const appleData = parseAppleData(rawAppleData);
        mergeData(appleData);
    }

    // 진단: 병합 후 게임별 건수 + 2026-06 항목 존재 여부
    const summary = Object.entries(combinedData).map(([game, items]) => ({
        game,
        count: items.length,
        latestDate: items.reduce((max, i) => i.date > max ? i.date : max, new Date(0)).toISOString().slice(0, 10)
    }));
    console.info('[reprocess] 게임별 집계:', summary);

    const all2026Jun = Object.values(combinedData).flat().filter(i =>
        i.date.getFullYear() === 2026 && i.date.getMonth() === 5
    );
    console.info(`[reprocess] 2026-06 항목 수: ${all2026Jun.length}`);
    if (all2026Jun.length > 0) {
        console.info('[reprocess] 2026-06 샘플:', all2026Jun.slice(0, 5).map(i => ({
            date: i.date.toISOString().slice(0, 10),
            title: i.title,
            price: i.price
        })));
    }
    
    if (Object.keys(combinedData).length > 0) {
        document.getElementById('keyword-manager')?.classList.remove('hidden');
    }

    updateUI();
    displayCurrentKeywords();
    displayKeywordSuggestions();
    displayEtcItemsList();
    displayAutoClassifyNote();
}

// '기타'로 분류된 결제 제목에서 게임 후보를 추출하는 휴리스틱.
// 1순위: 괄호/대괄호 안의 내용 (보통 게임 이름이 여기에 들어감, 예: "스타터 패키지 (게임명)")
// 2순위: 구분자(' - ', ' : ' 등) 앞부분
const TITLE_SEPARATORS = [' - ', ' – ', ' — ', ' : ', ' | ', ' / ', ' · '];
const PAREN_REGEX = /[(\[]([^)\]]+)[)\]]/g;
function guessAppNameFromTitle(title) {
    const t = (title || '').trim();

    // 1순위: 괄호 안 마지막 매칭 (제목 끝의 "(게임명)" 패턴이 가장 일반적)
    const matches = [...t.matchAll(PAREN_REGEX)];
    for (let i = matches.length - 1; i >= 0; i--) {
        const inner = matches[i][1].trim();
        if (inner.length > 1) return inner;
    }

    // 2순위: 구분자 앞부분
    for (const sep of TITLE_SEPARATORS) {
        const idx = t.indexOf(sep);
        if (idx > 2) return t.substring(0, idx).trim();
    }
    return t;
}

// publisher 또는 제목 prefix 기반으로 '기타' 항목을 그룹화한 후보 목록을 반환합니다.
// publisher가 있는 그룹이 더 신뢰도 높으므로 우선 노출합니다.
function extractAppCandidates() {
    const others = combinedData['기타'] || [];
    const publisherGroups = new Map();
    const titleGroups = new Map();
    const seenInPublisher = new Set(); // publisher 그룹에 들어간 item 인덱스

    others.forEach((item, i) => {
        const pub = (item.publisher || '').trim();
        if (pub && pub.length > 1) {
            if (!publisherGroups.has(pub)) {
                publisherGroups.set(pub, { count: 0, titles: new Set(), samples: [] });
            }
            const g = publisherGroups.get(pub);
            g.count++;
            g.titles.add(item.title);
            if (g.samples.length < 3 && !g.samples.includes(item.title)) {
                g.samples.push(item.title);
            }
            seenInPublisher.add(i);
        }
    });

    others.forEach((item, i) => {
        if (seenInPublisher.has(i)) return; // publisher 그룹에서 이미 다룸
        const guess = guessAppNameFromTitle(item.title);
        if (!guess) return;
        if (!titleGroups.has(guess)) {
            titleGroups.set(guess, { count: 0, titles: new Set(), samples: [] });
        }
        const g = titleGroups.get(guess);
        g.count++;
        g.titles.add(item.title);
        if (g.samples.length < 3 && !g.samples.includes(item.title)) {
            g.samples.push(item.title);
        }
    });

    const fromPub = Array.from(publisherGroups.entries()).map(([name, g]) => ({
        name, count: g.count, uniqueTitles: g.titles.size, samples: g.samples, source: 'publisher'
    }));
    const fromTitle = Array.from(titleGroups.entries()).map(([name, g]) => ({
        name, count: g.count, uniqueTitles: g.titles.size, samples: g.samples, source: 'title'
    }));

    return [...fromPub, ...fromTitle].sort((a, b) => b.count - a.count);
}

// '기타'의 모든 고유 제목을 표로 보여주는 raw 목록.
// 각 행에 '+ 새 앱' 버튼과 '폼 채우기' 버튼을 제공하여 휴리스틱이 못 잡은 항목도 직접 처리 가능.
function buildEtcUniqueRows() {
    const others = combinedData['기타'] || [];
    const map = new Map(); // title -> { count, publisher }
    others.forEach(item => {
        const key = item.title;
        if (!map.has(key)) {
            map.set(key, { count: 0, publisher: item.publisher || '' });
        }
        const row = map.get(key);
        row.count++;
        if (!row.publisher && item.publisher) row.publisher = item.publisher;
    });
    return Array.from(map.entries())
        .map(([title, info]) => ({ title, count: info.count, publisher: info.publisher }))
        .sort((a, b) => b.count - a.count);
}

function displayEtcItemsList() {
    const container = document.getElementById('etc-items-list');
    if (!container) return;

    const rows = buildEtcUniqueRows();
    if (rows.length === 0) {
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
    }

    const totalCount = (combinedData['기타'] || []).length;
    // 고유 제목이 매우 많을 때 모두 그리면 무거우므로 상위 N개만 렌더링한다.
    const ETC_RENDER_LIMIT = 200;
    const shown = rows.slice(0, ETC_RENDER_LIMIT);

    let bodyHTML = '';
    shown.forEach(r => {
        const pubBadge = r.publisher
            ? `<span class="etc-row-pub">${escapeHTML(r.publisher)}</span>`
            : '';
        const guessed = guessAppNameFromTitle(r.title);
        const guessBadge = (guessed && guessed !== r.title)
            ? `<span class="etc-row-guess">→ <strong>${escapeHTML(guessed)}</strong></span>`
            : '';
        bodyHTML += `
            <li class="etc-row">
                <div class="etc-row-main">
                    <div class="etc-row-title">
                        <span class="etc-row-text">${escapeHTML(r.title)}</span>
                        ${pubBadge}
                        ${guessBadge}
                    </div>
                    <span class="etc-row-count">${r.count}건</span>
                </div>
                <div class="etc-row-actions">
                    <button class="etc-add-new-btn" data-title="${escapeHTML(r.title)}">+ 새 앱으로</button>
                    <button class="etc-fill-form-btn" data-title="${escapeHTML(r.title)}">↑ 폼에 채우기</button>
                </div>
            </li>
        `;
    });

    const moreNote = rows.length > ETC_RENDER_LIMIT
        ? `<p class="etc-help">목록이 많아 상위 ${ETC_RENDER_LIMIT}개 제목만 표시했어요. 나머지 ${rows.length - ETC_RENDER_LIMIT}개는 위 추천 카드로 추가하거나 키워드를 등록하면 목록이 줄어듭니다.</p>`
        : '';

    container.innerHTML = `
        <details open>
            <summary><h3>📋 '기타' 전체 목록 (${rows.length}개 제목 / ${totalCount}건)</h3></summary>
            <p class="etc-help">위 후보가 못 잡은 항목까지 모두 확인할 수 있습니다. '+ 새 앱으로'는 제목 그대로 신규 앱을 등록하고, '↑ 폼에 채우기'는 위 입력 폼에 제목을 옮겨 기존 앱에 키워드로 추가할 수 있게 합니다.</p>
            <ul class="etc-list">${bodyHTML}</ul>
            ${moreNote}
        </details>
    `;
    container.classList.remove('hidden');
}

function addAppFromTitle(title) {
    if (!title) return;
    // 제목에서 괄호 안 게임명을 추출. 추출 실패 시 전체 제목 사용.
    const guessed = guessAppNameFromTitle(title);
    const name = (guessed && guessed.length > 1) ? guessed : title;
    if (!appKeywords[name]) appKeywords[name] = [];
    if (!appKeywords[name].includes(name)) appKeywords[name].push(name);
    reprocessAllData();
}

function fillFormWithTitle(title) {
    const appNameInput = document.getElementById('new-app-name');
    const keywordsInput = document.getElementById('new-keywords');
    if (keywordsInput) {
        keywordsInput.value = title;
        keywordsInput.focus();
    }
    if (appNameInput && !appNameInput.value) {
        appNameInput.focus();
    }
    appNameInput?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function displayKeywordSuggestions() {
    const container = document.getElementById('keyword-suggestions');
    if (!container) return;

    const candidates = extractAppCandidates();
    if (candidates.length === 0) {
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
    }

    let html = `
        <div class="suggestion-header">
            <h3>🔍 '기타'에서 발견된 후보 (${candidates.length})</h3>
            <button id="add-all-suggestions-btn" class="suggestion-bulk-btn">전체 추가</button>
        </div>
        <p class="suggestion-help">퍼블리셔(🏢)와 제목 속 게임명(📝, 괄호 안 우선)에서 추정한 후보입니다. 퍼블리셔 기반이 일반적으로 더 정확합니다.</p>
        <ul class="suggestion-list">`;
    candidates.forEach(c => {
        const sampleHTML = c.samples.map(t => `<li>${escapeHTML(t)}</li>`).join('');
        const badge = c.source === 'publisher'
            ? `<span class="suggestion-source pub">🏢 퍼블리셔</span>`
            : `<span class="suggestion-source title">📝 제목 추출</span>`;
        html += `
            <li class="suggestion-item">
                <div class="suggestion-main">
                    <div class="suggestion-info">
                        ${badge}
                        <strong>${escapeHTML(c.name)}</strong>
                        <span class="suggestion-count">${c.count}건 · ${c.uniqueTitles}개 상품</span>
                    </div>
                    <button class="suggestion-add-btn" data-name="${escapeHTML(c.name)}">+ 추가</button>
                </div>
                <ul class="suggestion-samples">${sampleHTML}</ul>
            </li>
        `;
    });
    html += '</ul>';
    container.innerHTML = html;
    container.classList.remove('hidden');
}

function addAppFromSuggestion(appName) {
    if (!appName) return;
    if (!appKeywords[appName]) {
        appKeywords[appName] = [];
    }
    if (!appKeywords[appName].includes(appName)) {
        appKeywords[appName].push(appName);
    }
    reprocessAllData();
}

function addAllSuggestions() {
    const candidates = extractAppCandidates();
    candidates.forEach(c => {
        if (!appKeywords[c.name]) {
            appKeywords[c.name] = [];
        }
        if (!appKeywords[c.name].includes(c.name)) {
            appKeywords[c.name].push(c.name);
        }
    });
    reprocessAllData();
}

// 퍼블리셔(🏢) 기반 후보만 자동으로 키워드 등록한다. 제목 추출(📝) 후보는 추정이라
// 자동 적용하지 않고 추천 카드로만 남긴다. 새로 등록한 그룹 수를 반환.
function autoApplyPublisherKeywords() {
    const candidates = extractAppCandidates().filter(c => c.source === 'publisher');
    let added = 0;
    candidates.forEach(c => {
        if (!appKeywords[c.name]) appKeywords[c.name] = [];
        if (!appKeywords[c.name].includes(c.name)) {
            appKeywords[c.name].push(c.name);
            if (!autoAppliedPublishers.includes(c.name)) autoAppliedPublishers.push(c.name);
            added++;
        }
    });
    return added;
}

// 자동 분류된 퍼블리셔 그룹을 사용자에게 알려주는 안내 박스. 사용자가 삭제한 그룹은 빼고 표시.
function displayAutoClassifyNote() {
    const el = document.getElementById('auto-classify-note');
    if (!el) return;

    const active = autoAppliedPublishers.filter(name => appKeywords[name]);
    if (active.length === 0) {
        el.innerHTML = '';
        el.classList.add('hidden');
        return;
    }

    const chips = active.map(n => `<span class="auto-chip">${escapeHTML(n)}</span>`).join('');
    el.innerHTML = `
        <p class="auto-classify-title">🤖 퍼블리셔 기준으로 ${active.length}개 그룹을 자동 분류했어요</p>
        <p class="auto-classify-help">잘못 묶였다면 아래 '키워드 관리'에서 삭제하거나 제목 추출 후보로 다시 분류할 수 있어요.</p>
        <div class="auto-chip-row">${chips}</div>
    `;
    el.classList.remove('hidden');
}

function mergeData(newData) {
    for (const gameName in newData) {
        if (combinedData[gameName]) {
            // 중복 데이터 방지를 위해 간단한 ID 생성 및 확인
            newData[gameName].forEach(newItem => {
                const newItemId = `${newItem.date.toISOString()}-${newItem.title}-${newItem.price}`;
                const isDuplicate = combinedData[gameName].some(existingItem => {
                    const existingItemId = `${existingItem.date.toISOString()}-${existingItem.title}-${existingItem.price}`;
                    return existingItemId === newItemId;
                });
                if (!isDuplicate) {
                    combinedData[gameName].push(newItem);
                }
            });
        } else {
            combinedData[gameName] = newData[gameName];
        }

        // 날짜순으로 정렬하여 병합된 데이터의 순서 유지
        combinedData[gameName].sort((a, b) => a.date - b.date);
    }
}

function updateUI() {
    const filteredData = getFilteredCombinedData();
    displayCurrencyOptions();
    displayOverallSummaries(filteredData);
    populateYearDetailSelector();
    populateGameSelector();
    displayOverallStatsChart(filteredData);
}

// 현재 appMode와 selectedYear에 따라 필터링된 데이터를 반환하는 헬퍼 함수
function getFilteredCombinedData() {
    const filtered = {};
    Object.keys(combinedData).forEach(gameName => {
        const items = combinedData[gameName].filter(item => {
            const modeMatch = appMode === 'all' || item.source === appMode;
            // 여기서 selectedYear는 displayOverallStatsChart 등에서 자체적으로 처리하므로
            // appMode 필터링만 우선 수행한 전체 맵을 반환합니다.
            return modeMatch;
        });
        if (items.length > 0) {
            filtered[gameName] = items;
        }
    });
    return filtered;
}

function populateYearDetailSelector() {
    const selector = document.getElementById('year-detail-select');
    const section = document.getElementById('yearly-detail-section');
    if (!selector) return;

    const currentFilteredData = getFilteredCombinedData();
    const allItems = Object.values(currentFilteredData).flat();
    const uniqueYears = [...new Set(allItems.map(item => item.date.getFullYear()))].sort((a, b) => b - a);

    if (uniqueYears.length === 0) {
        section.classList.add('hidden');
        document.getElementById('yearly-detail-summary')?.classList.add('hidden');
        return;
    }

    const currentSelected = selector.value;
    selector.innerHTML = '';

    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = '전체';
    selector.appendChild(allOption);

    uniqueYears.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = `${year}년`;
        selector.appendChild(option);
    });

    section.classList.remove('hidden');
    
    if (currentSelected && (currentSelected === 'all' || uniqueYears.includes(parseInt(currentSelected)))) {
        selector.value = currentSelected;
    } else {
        selector.value = 'all';
    }
    
    selectedYear = selector.value;
    displayYearlyDetailSummary(selector.value);
    populateGameSelector();
}

function displayYearlyDetailSummary(year) {
    const summaryDiv = document.getElementById('yearly-detail-summary');
    const currency = document.getElementById('currency-select').value;
    if (!summaryDiv || !year) return;

    let itemsToAnalyze = [];
    let titlePrefix = '';

    const currentFilteredData = getFilteredCombinedData();

    if (year === 'all') {
        itemsToAnalyze = Object.values(currentFilteredData).flat();
        titlePrefix = '전체 기간';
    } else {
        const yearInt = parseInt(year);
        itemsToAnalyze = Object.values(currentFilteredData).flat().filter(item => item.date.getFullYear() === yearInt);
        titlePrefix = `${year}년`;
    }
    
    const totals = calculateTotals(itemsToAnalyze);
    
    let topGame = { name: 'N/A', totals: {} };
    let maxKrwEquivalent = 0;

    Object.keys(currentFilteredData).forEach(gameName => {
        let gameItems = [];
        if (year === 'all') {
            gameItems = currentFilteredData[gameName];
        } else {
            const yearInt = parseInt(year);
            gameItems = currentFilteredData[gameName].filter(item => item.date.getFullYear() === yearInt);
        }

        const gameTotals = calculateTotals(gameItems);
        const krwTotal = gameTotals[currency] || 0;
        if (krwTotal > maxKrwEquivalent) {
            maxKrwEquivalent = krwTotal;
            topGame = { name: gameName, totals: gameTotals };
        }
    });

    if (Object.keys(totals).length > 0) {
        summaryDiv.innerHTML = `
            <span class="stat-label">📊 ${titlePrefix} 총 결제액</span>
            <span class="stat-value">${formatTotals(totals, currency)}</span>
            <span class="stat-sub">👑 최다 결제 · <strong>${topGame.name}</strong> (${formatTotals(topGame.totals, currency)})</span>
        `;
    } else {
        summaryDiv.innerHTML = `<span class="stat-label">해당 기간 정보가 없습니다.</span>`;
    }
    summaryDiv.classList.remove('hidden');
}

function calculateTotals(data){
    const totals = {}; // e.g., { '₩': 10000, '$': 50 }
    data.forEach(item => {
        if (!totals[item.currency]) {
            totals[item.currency] = 0;
        }
        totals[item.currency] += parseFloat(item.price);
    });
    return totals;
}

function formatTotals(totals, currencyFilter) {
    if (Object.keys(totals).length === 0) {
        return `<strong>${currencyFilter || '₩'}0</strong>`;
    }

    if (currencyFilter && totals[currencyFilter] !== undefined) {
        const amount = totals[currencyFilter];

        const formattedAmount = amount.toLocaleString();

        return `<strong>${currencyFilter}${formattedAmount}</strong>`;
    }

    return '';
}

// --- UI 표시 함수들 ---

function displayOverallSummaries(data = combinedData) {
    const overallSummarySection = document.getElementById('overall-summary-section');
    const overallSummaryDiv = document.getElementById('overall-summary');
    const topSpenderDiv = document.getElementById('top-spender-summary');
    const currency = document.getElementById('currency-select').value;

    const allItems = Object.values(data).flat();
    const grandTotals = calculateTotals(allItems);
    
    let topGame = { name: 'N/A', totals: {} };
    let maxKrwEquivalent = 0;

    Object.keys(data).forEach(gameName => {
        const gameTotals = calculateTotals(data[gameName]);
        const krwTotal = gameTotals[currency] || 0;
        if (krwTotal > maxKrwEquivalent) {
            maxKrwEquivalent = krwTotal;
            topGame = { name: gameName, totals: gameTotals };
        }
    });

    if (Object.keys(grandTotals).length > 0) {
        const storeLabel = appMode === 'google' ? 'Google Play' : (appMode === 'apple' ? 'Apple Store' : '모든 스토어');
        overallSummaryDiv.innerHTML = `
            <span class="stat-label">💸 총 결제액 · ${storeLabel}</span>
            <span class="stat-value">${formatTotals(grandTotals, currency)}</span>
        `;
        topSpenderDiv.innerHTML = `
            <span class="stat-label">👑 최다 결제 앱·게임</span>
            <span class="stat-value">${topGame.name}</span>
            <span class="stat-sub">${formatTotals(topGame.totals, currency)}</span>
        `;
        overallSummarySection.classList.remove('hidden');
    } else {
        overallSummarySection.classList.add('hidden');
    }
}

function populateGameSelector() {
    const selector = document.getElementById('game-selector');
    const selectorSection = document.getElementById('game-selector-section');
    const currency = document.getElementById('currency-select').value;

    if (!selector) return;

    selector.innerHTML = '';

    const currentFilteredData = getFilteredCombinedData();
    const finalFilteredData = {};
    Object.keys(currentFilteredData).forEach(gameName => {
        const items = currentFilteredData[gameName].filter(item => {
            const yearMatch = selectedYear === 'all' || item.date.getFullYear() === parseInt(selectedYear);
            const currencyMatch = item.currency === currency;
            return yearMatch && currencyMatch;
        });
        if (items.length > 0) {
            finalFilteredData[gameName] = items;
        }
    });

    const sortedGames = Object.keys(finalFilteredData).sort((a, b) => {
        const totalA = finalFilteredData[a].reduce((sum, item) => sum + item.price, 0);
        const totalB = finalFilteredData[b].reduce((sum, item) => sum + item.price, 0);
        return totalB - totalA;
    });

    if (sortedGames.length === 0) {
        selectorSection.classList.add('hidden');
        // 앱/게임 상세 분석이 없으므로 하단 섹션들을 숨김
        document.getElementById('summary').classList.add('hidden');
        document.getElementById('monthly-report').classList.add('hidden');
        document.getElementById('full-history').classList.add('hidden');
        return;
    }

    sortedGames.forEach(gameName => {
        const option = document.createElement('option');
        option.value = gameName;
        option.textContent = gameName;
        selector.appendChild(option);
    });

    selectorSection.classList.remove('hidden');
    const currentSelectedGame = selector.value;
    if (!sortedGames.includes(currentSelectedGame)) {
        updateDisplayForGame(sortedGames[0]);
    } else {
        updateDisplayForGame(currentSelectedGame);
    }
}

function updateDisplayForGame(gameName) {
    const currency = document.getElementById('currency-select').value;
    let gameData = combinedData[gameName] || [];

    gameData = gameData.filter(item => {
        const modeMatch = appMode === 'all' || item.source === appMode;
        const yearMatch = selectedYear === 'all' || item.date.getFullYear() === parseInt(selectedYear);
        return modeMatch && yearMatch;
    });

    currentGameData = gameData;

    displaySummary(currentGameData, currency);

    document.getElementById('summary').classList.remove('hidden');
    document.getElementById('monthly-report').classList.remove('hidden');
    document.getElementById('full-history').classList.remove('hidden');

    displayMonthlyReport(currentGameData, currency);
    displayFullHistory(currentGameData, currency);

    document.getElementById('search-input').value = '';
}

function displaySummary(data, currency) {
    const summaryDiv = document.getElementById('summary');
    if (!summaryDiv) return;
    
    if (data && data.length > 0) {
        const totalSpent = data
        .filter(item => item.currency === currency)
        .reduce((sum, item) => sum + item.price, 0);
        
        const yearLabel = selectedYear === 'all' ? '전체 기간' : `${selectedYear}년`;
        summaryDiv.innerHTML = `
            <span class="stat-label">🔍 선택한 앱·게임 · ${yearLabel}</span>
            <span class="stat-value">${currency}${totalSpent.toLocaleString()}</span>
        `;
        summaryDiv.classList.remove('hidden');
    } else {
        summaryDiv.classList.add('hidden');
    }
}

function displayMonthlyReport(data, currency) {
    const monthlyTotals = {};
    data.filter(item => item.currency === currency)
        .forEach(item => {
            const month = item.date.getFullYear() + '-' + String(item.date.getMonth() + 1).padStart(2, '0');
            if (!monthlyTotals[month]) {
                monthlyTotals[month] = [];
            }
            monthlyTotals[month].push(item);
    });

    const accordionContainer = document.getElementById('monthly-accordion');
    accordionContainer.innerHTML = '';
    
    const sortedMonths = Object.keys(monthlyTotals).sort();
    
    sortedMonths.forEach(month => {
        const items = monthlyTotals[month];
        const totalAmount = items.reduce((sum, item) => sum + item.price, 0);

        let detailsHTML = '<table><tbody>';
        items.sort((a,b) => a.date - b.date).forEach(item => {
            detailsHTML += `
                <tr>
                    <td data-label="날짜">${getLocalDateString(item.date)}</td>
                    <td data-label="상품명">${item.title}</td>
                    <td data-label="금액">${currency}${item.price.toLocaleString()}</td>
                </tr>
            `;
        });
        detailsHTML += '</tbody></table>';

        const monthItem = document.createElement('div');
        monthItem.className = 'month-item';
        monthItem.innerHTML = `
            <div class="month-summary">
                <span>${month}</span>
                <span>${currency}${totalAmount.toLocaleString()}</span>
            </div>
            <div class="month-details">${detailsHTML}</div>
        `;
        accordionContainer.appendChild(monthItem);
    });

    displayMonthlyChart(Object.keys(monthlyTotals).reduce((acc, month) => {
        acc[month] = monthlyTotals[month].reduce((sum, item) => sum + item.price, 0);
        return acc;
    }, {}));
}

function displayMonthlyChart(monthlyData) {
    const chartContainer = document.getElementById('monthly-chart-container');
    const sortedMonths = Object.keys(monthlyData).sort();
    
    if(sortedMonths.length === 0) {
        chartContainer.innerHTML = '차트를 표시할 데이터가 없습니다.';
        return;
    }

    const amounts = sortedMonths.map(month => monthlyData[month]);
    const maxAmount = Math.max(...amounts, 1);

    let chartHTML = '';
    let lastYear = '';

    sortedMonths.forEach(month => {
        const amount = monthlyData[month];
        const barHeight = (amount / maxAmount) * 90; 
        
        const currentYear = month.substring(2, 4);
        const currentMonth = month.substring(5);
        
        let label = (currentYear !== lastYear) ? `${currentYear}년\n${currentMonth}월` : `${currentMonth}월`;
        lastYear = currentYear;

        chartHTML += `
            <div class="chart-bar-wrapper"> 
                <div class="chart-amount">₩${amount.toLocaleString()}</div>
                <div class="chart-bar" style="height: ${barHeight}%;" title="${month}: ₩${amount.toLocaleString()}"></div>
                <div class="chart-label">${label}</div>
            </div>
        `;
    });
    chartContainer.innerHTML = chartHTML;
}

function displayFullHistory(data, currency) {
    const table = document.getElementById('details-table');
    let tableHTML = `<thead><tr><th>날짜</th><th>상품명</th><th>결제 금액</th></tr></thead><tbody>`;
    if (data.length === 0) {
        tableHTML += `<tr><td colspan="3" style="text-align:center;">표시할 내역이 없습니다.</td></tr>`;
    } else {
        [...data].reverse()
                 .filter(item => item.currency === currency)
                 .forEach(item => {
                    tableHTML += `
                        <tr>
                            <td data-label="날짜">${getLocalDateString(item.date)}</td>
                            <td data-label="상품명">${item.title}</td>
                            <td data-label="결제 금액">${currency}${item.price.toLocaleString()}</td>
                        </tr>
                    `;
        });
    }
    table.innerHTML = tableHTML + `</tbody>`;
}

function displayCurrencyOptions() {
    const currencySelect = document.getElementById('currency-section');
    if (!currencySelect) return;

    const currentFilteredData = getFilteredCombinedData();
    const allItems = Object.values(currentFilteredData).flat();
    const uniqueCurrencies = [...new Set(allItems.map(item => item.currency))];
    const select = document.getElementById('currency-select');
    const prevValue = select.value;
    select.innerHTML = '';

    uniqueCurrencies.forEach(currency => {
        const option = document.createElement('option');
        option.value = currency;
        option.textContent = currency;
        select.appendChild(option);
    });
    if (uniqueCurrencies.length === 0) {
        currencySelect.classList.add('hidden');
        return;
    }

    currencySelect.classList.remove('hidden');
}

function displayOverallStatsChart(data) {
    const overallStatsSection = document.getElementById('overall-stats-section');
    const canvas = document.getElementById('overall-spending-chart');
    const currency = document.getElementById('currency-select').value;
    const chartType = document.getElementById('overall-chart-type').value;

    if (!canvas) return; // 해당 캔버스가 없는 페이지일 수 있음

    const ctx = canvas.getContext('2d');

    // Chart.js는 CSS 변수를 못 읽으므로 현재 테마에 맞춰 축·범례·그리드 색을 직접 지정.
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    Chart.defaults.color = isDark ? '#a6abb6' : '#5f6470';
    Chart.defaults.borderColor = isDark ? 'rgba(255, 255, 255, .09)' : 'rgba(24, 24, 27, .07)';

    if (Object.keys(data).length === 0) {
        overallStatsSection.classList.add('hidden');
        return;
    }
    overallStatsSection.classList.remove('hidden');

    const allItems = Object.values(data).flat().filter(item => item.currency === currency);
     
    if(allItems.length === 0) {
        if (overallChartInstance) overallChartInstance.destroy();
         overallStatsSection.classList.add('hidden');
        return;
    }

    let minDate = new Date();
    let maxDate = new Date(1970, 0, 1);
    allItems.forEach(item => {
        if (item.date < minDate) minDate = item.date;
        if (item.date > maxDate) maxDate = item.date;
    });

    const gameTotals = Object.keys(data).map(gameName => ({
        name: gameName,
        total: data[gameName].filter(d => d.currency === currency).reduce((sum, item) => sum + item.price, 0)
    })).filter(g => g.total > 0);

    const topGames = gameTotals.sort((a, b) => b.total - a.total).slice(0, 7);
    // '기타'는 미분류 결제의 표시 단서라 top 7에 없더라도 별개 라인으로 항상 노출
    const otherBucket = gameTotals.find(g => g.name === '기타');
    if (otherBucket && !topGames.some(g => g.name === '기타')) {
        topGames.push(otherBucket);
    }
    const colors = ['#3498db', '#e74c3c', '#2ecc71', '#f1c40f', '#9b59b6', '#34495e', '#1abc9c', '#95a5a6'];

    let chartLabels = [];
    let datasets = [];
    let chartBaseType = 'line';

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            title: {
                display: true,
                text: ''
            },
            tooltip: {
                mode: 'index',
                intersect: false,
                callbacks: {
                    label: function(context) {
                        let label = context.dataset.label || '';
                        if (label) label += ': ';
                        if (context.parsed.y !== null) {
                            label += currency + context.parsed.y.toLocaleString();
                        }
                        return label;
                    }
                }
            },
        },
        scales: {
            x: {
                title: { display: true, text: '' }
            },
            y: {
                title: { display: true, text: '' },
                ticks: {
                    callback: function(value) {
                        return currency + value.toLocaleString();
                    }
                }
            }
        }
    };

    if (chartType === 'cumulative') {
        const periodKeys = [];
        let currentDate = new Date(minDate.getFullYear(), minDate.getMonth() < 6 ? 0 : 6, 1);

        while (currentDate <= maxDate) {
            const year = currentDate.getFullYear();
            const isFirstHalf = currentDate.getMonth() < 6;
            chartLabels.push(`${year} ${isFirstHalf ? '상반기' : '하반기'}`);
            periodKeys.push(`${year}-${isFirstHalf ? 'H1' : 'H2'}`);
            currentDate.setMonth(currentDate.getMonth() + 6);
        }

        datasets = topGames.map((game, index) => {
            const periodTotals = {};
            periodKeys.forEach(key => periodTotals[key] = 0);

            data[game.name].filter(d => d.currency === currency).forEach(item => {
                const year = item.date.getFullYear();
                const isFirstHalf = item.date.getMonth() < 6;
                const key = `${year}-${isFirstHalf ? 'H1' : 'H2'}`;
                if (periodTotals.hasOwnProperty(key)) {
                    periodTotals[key] += item.price;
                }
            });

            const cumulativeData = [];
            let cumulativeTotal = 0;
            periodKeys.forEach(key => {
                cumulativeTotal += periodTotals[key];
                cumulativeData.push(cumulativeTotal);
            });

            const color = colors[index % colors.length];

            return {
                label: game.name,
                data: cumulativeData,
                borderColor: color,
                backgroundColor: color + '33',
                fill: false,
                tension: 0.1
            };
        });

        options.plugins.title.text = '누적 결제액 상위 게임 추이 (' + currency + ' 기준, 6개월 단위)';
        options.scales.x.title.text = '기간';
        options.scales.y.title.text = '누적 결제액 (' + currency + ')';
        chartBaseType = 'line';
    } else {
        // Yearly mode
        const years = [];
        for (let y = minDate.getFullYear(); y <= maxDate.getFullYear(); y++) {
            years.push(y);
        }
        chartLabels = years.map(y => `${y}년`);

        datasets = topGames.map((game, index) => {
            const yearlyTotals = years.map(year => {
                return data[game.name]
                    .filter(d => d.currency === currency && d.date.getFullYear() === year)
                    .reduce((sum, item) => sum + item.price, 0);
            });

            const color = colors[index % colors.length];

            return {
                label: game.name,
                data: yearlyTotals,
                backgroundColor: color,
                borderColor: color,
                borderWidth: 1
            };
        });

        options.plugins.title.text = '년도별 결제 금액 (' + currency + ' 기준)';
        options.scales.x.title.text = '년도';
        options.scales.y.title.text = '연간 결제액 (' + currency + ')';
        options.scales.x.stacked = true;
        options.scales.y.stacked = true;
        chartBaseType = 'bar';
    }

    if (overallChartInstance) {
        overallChartInstance.destroy();
    }
    overallChartInstance = new Chart(ctx, {
        type: chartBaseType,
        data: {
            labels: chartLabels,
            datasets: datasets
        },
        options: options
    });
}

function setupEventListeners() {
    const gameSelector = document.getElementById('game-selector');
    const currencySelect = document.getElementById('currency-select');
    const chartTypeSelect = document.getElementById('overall-chart-type');

    if(gameSelector){
        gameSelector.addEventListener('change', (e) => {
            updateDisplayForGame(e.target.value);
        });
    }
    if(currencySelect){
        currencySelect.addEventListener('change', () => {
            if (gameSelector) {
                displayOverallSummaries();
                populateYearDetailSelector();
                if (overallChartInstance) {
                    overallChartInstance.destroy();
                    overallChartInstance = null;
                }
                displayOverallStatsChart(combinedData);
                populateGameSelector();
                updateDisplayForGame(gameSelector.value);
            }
        });
    }

    if (chartTypeSelect) {
        chartTypeSelect.addEventListener('change', () => {
            displayOverallStatsChart(combinedData);
        });
    }

    const yearDetailSelect = document.getElementById('year-detail-select');
    if (yearDetailSelect) {
        yearDetailSelect.addEventListener('change', (e) => {
            selectedYear = e.target.value;
            displayYearlyDetailSummary(selectedYear);
            populateGameSelector();
        });
    }


    const searchInput = document.getElementById('search-input');
    if(searchInput) {
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const filteredData = currentGameData.filter(item => 
                item.title.toLowerCase().includes(searchTerm)
            );
            const currency = document.getElementById('currency-select').value;
            displayFullHistory(filteredData, currency);
        });
    }

    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const mode = link.dataset.mode;
            switchAppMode(mode);
        });
    });

    const accordionContainer = document.getElementById('monthly-accordion');
    if(accordionContainer) {
        accordionContainer.addEventListener('click', function(e) {
            const summary = e.target.closest('.month-summary');
            if (summary) {
                summary.parentElement.classList.toggle('active');
            }
        });
    }

    const resetButton = document.getElementById('resetButton');
    if (resetButton) {
        resetButton.addEventListener('click', () => {
            resetAllData();
        });
    }
}

function resetAllData() {
    combinedData = {};
    currentGameData = [];
    rawGoogleData = null;
    rawAppleData = null;
    selectedYear = 'all';
    autoAppliedPublishers = [];

    if (overallChartInstance) {
        overallChartInstance.destroy();
        overallChartInstance = null;
    }

    ['overall-summary-section', 'overall-stats-section', 'yearly-detail-section', 'yearly-detail-summary', 'game-selector-section', 'summary', 'monthly-report', 'full-history', 'currency-section', 'keyword-manager', 'auto-classify-note'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    
    const googleInput = document.getElementById('googleFileInput');
    const appleInput = document.getElementById('appleFileInput');
    const googleStatus = document.getElementById('googleFileStatus');
    const appleStatus = document.getElementById('appleFileStatus');

    if(googleInput) googleInput.value = '';
    if(appleInput) appleInput.value = '';
    if(googleStatus) googleStatus.textContent = '';
    if(appleStatus) appleStatus.textContent = '';
}

function switchAppMode(mode) {
    // 탭 변경 시 데이터 초기화 (사용자 요청 사항)
    resetAllData();

    appMode = mode;
    
    // URL 해시 업데이트 (페이지 새로고침 없이 상태 유지)
    if (window.location.hash.substring(1) !== mode) {
        window.location.hash = mode;
    }

    const googleBox = document.getElementById('google-upload-box');
    const appleBox = document.getElementById('apple-upload-box');
    const mainTitle = document.getElementById('main-title');
    const navLinks = document.querySelectorAll('.nav-link');
    const descriptions = document.querySelectorAll('.page-description');

    navLinks.forEach(link => {
        if (link.dataset.mode === mode) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });

    descriptions.forEach(desc => desc.classList.add('hidden'));
    document.getElementById(`description-${mode}`).classList.remove('hidden');

    if (mode === 'google') {
        if (googleBox) googleBox.classList.remove('hidden');
        if (appleBox) appleBox.classList.add('hidden');
        mainTitle.innerHTML = '📑 Sort Orders · Google Play';
    } else if (mode === 'apple') {
        if (googleBox) googleBox.classList.add('hidden');
        if (appleBox) appleBox.classList.remove('hidden');
        mainTitle.innerHTML = '📑 Sort Orders · Apple Store';
    } else {
        if (googleBox) googleBox.classList.remove('hidden');
        if (appleBox) appleBox.classList.remove('hidden');
        mainTitle.innerHTML = '📑 Sort Orders · 결제 정리함';
    }

    // 데이터 재처리 (이미 데이터가 있는 경우 현재 모드에 맞춰 UI 갱신)
    if (Object.keys(combinedData).length > 0) {
        updateUI();
    }
}

function setupKeywordManagement() {
    const addKeywordBtn = document.getElementById('add-keyword-btn');
    const appNameInput = document.getElementById('new-app-name');
    const keywordsInput = document.getElementById('new-keywords');
    const keywordsList = document.getElementById('keywords-list');
    const keywordSearchInput = document.getElementById('keyword-search-input');

    if (!addKeywordBtn) return;

    addKeywordBtn.addEventListener('click', () => {
        const appName = appNameInput.value.trim();
        const keywords = keywordsInput.value.trim();

        if (!appName || !keywords) {
            alert('앱 이름과 키워드를 모두 입력해주세요.');
            return;
        }

        const keywordArray = keywords.split(',').map(k => k.trim()).filter(k => k);

        if (!appKeywords[appName]) {
            appKeywords[appName] = [];
        }

        keywordArray.forEach(keyword => {
            if (!appKeywords[appName].includes(keyword)) {
                appKeywords[appName].push(keyword);
            }
        });

        appNameInput.value = '';
        keywordsInput.value = '';

        reprocessAllData();
    });

    keywordsList.addEventListener('click', (event) => {
        const target = event.target;
        if (target.classList.contains('delete-keyword-btn')) {
            const appName = target.dataset.appName;
            const keyword = target.dataset.keyword;

            if (keyword) { // 개별 키워드 삭제
                const keywords = appKeywords[appName];
                const index = keywords.indexOf(keyword);
                if (index > -1) {
                    keywords.splice(index, 1);
                }
                if (keywords.length === 0) {
                    delete appKeywords[appName];
                }
            } else { // 앱 이름 전체 삭제
                delete appKeywords[appName];
            }
            
            reprocessAllData();
        }
    });

    let keywordSearchTimer = null;
    keywordSearchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        // 입력마다 전체 목록을 다시 그리지 않도록 디바운스
        clearTimeout(keywordSearchTimer);
        keywordSearchTimer = setTimeout(() => displayCurrentKeywords(searchTerm), 120);
    });

    const suggestionsContainer = document.getElementById('keyword-suggestions');
    if (suggestionsContainer) {
        suggestionsContainer.addEventListener('click', (e) => {
            const target = e.target;
            if (target.classList.contains('suggestion-add-btn')) {
                addAppFromSuggestion(target.dataset.name);
            } else if (target.id === 'add-all-suggestions-btn') {
                addAllSuggestions();
            }
        });
    }

    const etcContainer = document.getElementById('etc-items-list');
    if (etcContainer) {
        etcContainer.addEventListener('click', (e) => {
            const target = e.target;
            if (target.classList.contains('etc-add-new-btn')) {
                addAppFromTitle(target.dataset.title);
            } else if (target.classList.contains('etc-fill-form-btn')) {
                fillFormWithTitle(target.dataset.title);
            }
        });
    }
}

function displayCurrentKeywords(searchTerm = '') {
    const listElement = document.getElementById('keywords-list');
    if (!listElement) return;

    listElement.innerHTML = '';
    
    const filteredKeywords = Object.keys(appKeywords).filter(appName => {
        if (searchTerm === '') return true;
        const keywords = appKeywords[appName].join(', ').toLowerCase();
        return appName.toLowerCase().includes(searchTerm) || keywords.includes(searchTerm);
    });

    filteredKeywords.forEach(appName => {
        const appLi = document.createElement('li');
        appLi.innerHTML = `<strong>${appName}</strong>`;
        
        const appDeleteBtn = document.createElement('button');
        appDeleteBtn.textContent = '앱 전체 삭제';
        appDeleteBtn.className = 'delete-keyword-btn app-delete';
        appDeleteBtn.dataset.appName = appName;
        appLi.appendChild(appDeleteBtn);
        listElement.appendChild(appLi);

        const keywordsLi = document.createElement('li');
        const keywordsSpan = document.createElement('span');
        keywordsSpan.style.wordBreak = 'break-all';

        appKeywords[appName].forEach(keyword => {
            const keywordContainer = document.createElement('span');
            keywordContainer.className = 'keyword-tag';
            
            const keywordSpan = document.createElement('span');
            keywordSpan.textContent = keyword;
            
            const keywordDeleteBtn = document.createElement('button');
            keywordDeleteBtn.textContent = 'x';
            keywordDeleteBtn.className = 'delete-keyword-btn';
            keywordDeleteBtn.dataset.appName = appName;
            keywordDeleteBtn.dataset.keyword = keyword;
            keywordDeleteBtn.title = `'${keyword}' 키워드 삭제`;
            
            keywordContainer.appendChild(keywordSpan);
            keywordContainer.appendChild(keywordDeleteBtn);
            keywordsSpan.appendChild(keywordContainer);
        });
        keywordsLi.appendChild(keywordsSpan);
        listElement.appendChild(keywordsLi);
    });
}

async function loadUpdateHistory() {
    const container = document.getElementById("updateLogContainer");
    if (!container) return;

    try {
        const response = await fetch('updates.json');
        if (!response.ok) throw new Error('Network response was not ok');
        const updates = await response.json();

        if (!Array.isArray(updates) || updates.length === 0) {
            container.innerHTML = '<p class="update-empty">아직 등록된 업데이트 내역이 없습니다.</p>';
            return;
        }

        let html = '';
        updates.forEach(update => {
            html += `
                <div class="update-item">
                    <span class="update-date">${update.date}</span>
                    <span class="update-title">${update.title}</span>
                    <ul class="update-list">
                        ${update.items.map(item => `<li>${item}</li>`).join('')}
                    </ul>
                </div>
            `;
        });
        container.innerHTML = html;
    } catch (error) {
        console.error("업데이트 내역 로드 실패:", error);
        container.innerHTML = "<p>업데이트 내역을 불러오지 못했습니다.</p>";
    }
}

function setupUpdateHistoryModal() {
    const modal = document.getElementById("updateModal");
    const btn = document.getElementById("updateHistoryBtn");
    const span = document.querySelector(".close-modal");

    if (btn && modal) {
        btn.onclick = function(e) {
            e.preventDefault();
            modal.style.display = "block";
            loadUpdateHistory();
        }
    }

    if (span && modal) {
        span.onclick = function() {
            modal.style.display = "none";
        }
    }

    window.addEventListener('click', function(event) {
        if (event.target == modal) {
            modal.style.display = "none";
        }
    });
}

// 라이트/다크 토글. data-theme은 head 인라인 스크립트가 이미 적용했고, 여기선 버튼 동작만 연결.
function setupThemeToggle() {
    const btn = document.getElementById('themeToggleBtn');
    if (!btn) return;

    const syncIcon = () => {
        const dark = document.documentElement.getAttribute('data-theme') === 'dark';
        btn.textContent = dark ? '☀️' : '🌙';
        btn.setAttribute('aria-label', dark ? '라이트 모드로 전환' : '다크 모드로 전환');
    };
    syncIcon();

    btn.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
        syncIcon();
        // Chart.js는 CSS 변수를 모르므로 테마 색을 다시 입혀 새로 그린다.
        if (overallChartInstance) displayOverallStatsChart(getFilteredCombinedData());
    });
}

document.addEventListener('DOMContentLoaded', () => {
    setupFileInputListeners();
    setupEventListeners();
    setupKeywordManagement();
    displayCurrentKeywords();
    setupUpdateHistoryModal();
    setupThemeToggle();

    // 초기 모드 설정 (URL 해시값 확인 또는 기본값 'all')
    const hash = window.location.hash.substring(1);
    const validModes = ['all', 'google', 'apple'];
    if (validModes.includes(hash)) {
        switchAppMode(hash);
    } else {
        switchAppMode('all');
    }
});

// 해시 변경 감지 (뒤로 가기/앞으로 가기 대응)
window.addEventListener('hashchange', () => {
    const hash = window.location.hash.substring(1);
    const validModes = ['all', 'google', 'apple'];
    if (validModes.includes(hash)) {
        switchAppMode(hash);
    }
});

