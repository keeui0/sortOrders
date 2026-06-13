let combinedData = {};
let rawGoogleData = null;
let rawAppleData = null;

document.addEventListener('DOMContentLoaded', () => {
    setupFileInputListeners();
    setupUpdateHistoryModal();
    setupSelectorListeners();

    const startBtn = document.getElementById('start-recap-btn');
    const closeBtn = document.getElementById('close-recap-btn');
    const overlay = document.getElementById('recap-overlay');

    if (startBtn) startBtn.addEventListener('click', startRecapSequence);
    if (closeBtn) closeBtn.addEventListener('click', () => {
        overlay.classList.add('hidden');
        document.getElementById('recap-content-area').innerHTML = '';
        currentSlideIndex = 0;
    });
});

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

async function loadUpdateHistory() {
    const container = document.getElementById("updateLogContainer");
    if (!container) return;

    try {
        const response = await fetch('updates.json');
        if (!response.ok) throw new Error('Network response was not ok');
        const updates = await response.json();

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

// --- 1. 파일 업로드 및 데이터 처리 ---
function setupFileInputListeners() {
    const googleInput = document.getElementById('googleFileInput');
    const appleInput = document.getElementById('appleFileInput');

    if (googleInput) googleInput.addEventListener('change', (e) => handleFileUpload(e, 'google'));
    if (appleInput) appleInput.addEventListener('change', (e) => handleFileUpload(e, 'apple'));
}

function handleFileUpload(event, type) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const fileContent = e.target.result;
            const statusId = type === 'google' ? 'googleFileStatus' : 'appleFileStatus';

            if (type === 'google') {
                rawGoogleData = JSON.parse(fileContent);
            } else {
                const parser = new DOMParser();
                rawAppleData = parser.parseFromString(fileContent, "text/html");
            }

            const statusElem = document.getElementById(statusId);
            if(statusElem) statusElem.textContent = `✅ ${file.name} 준비 완료!`;

            processData();

        } catch (error) {
            alert('파일 처리 중 오류가 발생했습니다.');
            console.error(error);
        }
    };
    reader.readAsText(file, 'UTF-8');
}

function processData() {
    combinedData = {};
    if (rawGoogleData) mergeData(parseGoogleData(rawGoogleData));
    if (rawAppleData) mergeData(parseAppleData(rawAppleData));

    populateYearSelect();
    populateGameSelect();
    refreshStartButton();
}

function mergeData(newData) {
    for (const gameName in newData) {
        if (!combinedData[gameName]) combinedData[gameName] = [];
        newData[gameName].forEach(newItem => {
            combinedData[gameName].push(newItem);
        });
    }
}

// 업로드된 데이터에서 결제가 발생한 연도를 추출해 select를 채웁니다.
function populateYearSelect() {
    const select = document.getElementById('year-select');
    if (!select) return;

    const allItems = Object.values(combinedData).flat();
    const years = [...new Set(allItems.map(item => item.date.getFullYear()))]
        .sort((a, b) => b - a);

    if (years.length === 0) {
        select.innerHTML = '<option value="">결제 내역이 없습니다</option>';
        select.disabled = true;
        return;
    }

    select.innerHTML = '';
    years.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = `${year}년`;
        select.appendChild(option);
    });
    select.disabled = false;
}

// 현재 선택된 연도에 결제가 있는 게임 + '전체 통합' 옵션으로 select를 채웁니다.
function populateGameSelect() {
    const yearSelect = document.getElementById('year-select');
    const gameSelect = document.getElementById('recap-game-select');
    if (!yearSelect || !gameSelect) return;

    const year = parseInt(yearSelect.value);
    if (!year) {
        gameSelect.innerHTML = '<option value="">파일을 업로드해주세요</option>';
        gameSelect.disabled = true;
        return;
    }

    const gameTotals = Object.entries(combinedData)
        .map(([game, items]) => {
            const yearItems = items.filter(i => i.date.getFullYear() === year);
            return { game, total: yearItems.reduce((sum, i) => sum + i.price, 0), count: yearItems.length };
        })
        .filter(g => g.count > 0)
        .sort((a, b) => b.total - a.total);

    if (gameTotals.length === 0) {
        gameSelect.innerHTML = '<option value="">선택한 연도에 결제 내역이 없습니다</option>';
        gameSelect.disabled = true;
        return;
    }

    gameSelect.innerHTML = '';

    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = `전체 통합 (${gameTotals.length}개 게임)`;
    gameSelect.appendChild(allOption);

    gameTotals.forEach(({ game }) => {
        const option = document.createElement('option');
        option.value = game;
        option.textContent = game;
        gameSelect.appendChild(option);
    });

    gameSelect.disabled = false;
}

function refreshStartButton() {
    const btn = document.getElementById('start-recap-btn');
    if (!btn) return;

    const gameSelect = document.getElementById('recap-game-select');
    const hasSelectableScope = gameSelect && !gameSelect.disabled && gameSelect.value;

    btn.disabled = !hasSelectableScope;
    if (hasSelectableScope) {
        btn.classList.add('ready');
        btn.textContent = "🎬 결산 시작하기 (준비됨!)";
    } else {
        btn.classList.remove('ready');
        btn.textContent = "🎬 결산 시작하기";
    }
}

function setupSelectorListeners() {
    const yearSelect = document.getElementById('year-select');
    const gameSelect = document.getElementById('recap-game-select');

    if (yearSelect) {
        yearSelect.addEventListener('change', () => {
            populateGameSelect();
            refreshStartButton();
        });
    }
    if (gameSelect) {
        gameSelect.addEventListener('change', refreshStartButton);
    }
}

// --- 2. 결산(Recap) 슬라이드 생성 ---

let currentSlideIndex = 0;
let recapSlides = [];

function startRecapSequence() {
    const year = parseInt(document.getElementById('year-select').value);
    const scope = document.getElementById('recap-game-select').value; // 'all' or 게임명

    if (!year || !scope) {
        alert('연도와 결산 대상을 선택해주세요.');
        return;
    }

    // scope에 해당하는 데이터 추출
    const scopedByGame = {};
    Object.entries(combinedData).forEach(([game, items]) => {
        if (scope !== 'all' && scope !== game) return;
        const yearItems = items.filter(i => i.date.getFullYear() === year)
            .sort((a, b) => a.date - b.date);
        if (yearItems.length > 0) scopedByGame[game] = yearItems;
    });

    const allItems = Object.values(scopedByGame).flat();

    if (allItems.length === 0) {
        const label = scope === 'all' ? '결제 내역' : `${scope} 결제 내역`;
        alert(`${year}년에는 ${label}이 없습니다.`);
        return;
    }

    // 통화별 총액
    const totalsByCurrency = {};
    allItems.forEach(item => {
        totalsByCurrency[item.currency] = (totalsByCurrency[item.currency] || 0) + item.price;
    });
    const primaryCurrency = totalsByCurrency['₩'] !== undefined
        ? '₩'
        : Object.keys(totalsByCurrency)[0];
    const primaryTotal = totalsByCurrency[primaryCurrency];

    // 월별 집계 (Primary currency 기준)
    const monthlyDetails = {};
    const monthlySpent = {};
    allItems.forEach(item => {
        if (item.currency !== primaryCurrency) return;
        const month = item.date.getMonth() + 1;
        monthlySpent[month] = (monthlySpent[month] || 0) + item.price;
        if (!monthlyDetails[month]) monthlyDetails[month] = [];
        let displayTitle = item.title;
        if (displayTitle.length > 18) displayTitle = displayTitle.substring(0, 18) + '..';
        monthlyDetails[month].push({ name: displayTitle, price: item.price });
    });

    let maxMonth = 0, maxMonthAmount = 0;
    for (const [m, amt] of Object.entries(monthlySpent)) {
        if (amt > maxMonthAmount) {
            maxMonthAmount = amt;
            maxMonth = parseInt(m);
        }
    }

    // 게임별 합계 (Top N 슬라이드용)
    const gameTotalsList = Object.entries(scopedByGame).map(([game, items]) => {
        const totals = {};
        items.forEach(i => {
            totals[i.currency] = (totals[i.currency] || 0) + i.price;
        });
        return { game, totals, primary: totals[primaryCurrency] || 0, count: items.length };
    }).sort((a, b) => b.primary - a.primary);

    const isInProgress = year === new Date().getFullYear();
    const periodLabel = isInProgress ? `${year}년 (진행 중)` : `${year}년`;
    const scopeLabel = scope === 'all' ? '전체 게임' : scope;
    const captureScope = scope === 'all' ? 'all' : scope.replace(/[^a-zA-Z0-9가-힣]/g, '_');

    // --- 슬라이드 데이터 구성 ---
    recapSlides = [];

    // 1. 인트로
    recapSlides.push({
        type: 'intro',
        content: `
            <div class="slide-content fade-in-up">
                <h2>${periodLabel} ${scopeLabel}</h2>
                <h1 class="highlight-text">결제 결산</h1>
                <p>한 해 동안의 지출을 돌아봅니다.</p>
            </div>
        `
    });

    // 2. 총액
    const otherTotalsHTML = Object.entries(totalsByCurrency)
        .filter(([cur]) => cur !== primaryCurrency)
        .map(([cur, amt]) => `<p style="font-size:0.9em;color:#dfe6e9;margin-top:8px;">${cur}${amt.toLocaleString()}</p>`)
        .join('');
    const totalHeading = isInProgress ? '지금까지 결제한 금액' : '한 해 동안 결제한 금액';
    recapSlides.push({
        type: 'total',
        amount: primaryTotal,
        currency: primaryCurrency,
        content: `
            <div class="slide-content fade-in-up">
                <h2>${totalHeading}</h2>
                <div class="big-number odometer" id="total-amount">0</div>
                <p>${primaryCurrency}</p>
                ${otherTotalsHTML}
            </div>
        `
    });

    // 3. Top N 게임 (전체 통합 모드에서만)
    if (scope === 'all' && gameTotalsList.length > 1) {
        const topN = gameTotalsList.slice(0, 7);
        const totalForRanking = topN.reduce((sum, g) => sum + g.primary, 0) || 1;
        recapSlides.push({
            type: 'top_games',
            title: '🏆 가장 많이 결제한 게임 Top 7',
            data: topN,
            primaryCurrency: primaryCurrency,
            totalRef: totalForRanking
        });
    }

    // 4. 월별 타임라인
    recapSlides.push({
        type: 'monthly_timeline',
        title: '🗓️ 월별 결제 내역',
        data: monthlyDetails,
        primaryCurrency: primaryCurrency,
        year: year,
        scope: scope,
        scopeLabel: scopeLabel,
        captureScope: captureScope,
        isInProgress: isInProgress
    });

    // 5. 최고 지출 월
    if (maxMonth > 0) {
        recapSlides.push({
            type: 'max_month_receipt',
            month: maxMonth,
            amount: maxMonthAmount,
            items: monthlyDetails[maxMonth] || [],
            primaryCurrency: primaryCurrency,
            title: `🔥 가장 지갑이 얇아졌던 달: ${maxMonth}월`
        });
    }

    // 6. 아웃트로
    const outroMessage = isInProgress
        ? '남은 한 해도 즐거운 게임 라이프 되세요!'
        : '내년에도 즐거운 게임 라이프 되세요!';
    recapSlides.push({
        type: 'outro',
        year: year,
        content: `
            <div class="slide-content fade-in-up">
                <h2>수고하셨습니다!</h2>
                <p>${outroMessage}</p>
                <div class="button-group" style="margin-top: 20px; display:flex; flex-direction:column; gap:10px; align-items:center;">
                    <button class="save-img-btn" onclick="downloadLongReceipt()">📸 전체 영수증 이미지 저장</button>
                    <button class="restart-btn" onclick="location.reload()">처음으로</button>
                </div>
            </div>
        `
    });

    document.getElementById('recap-overlay').classList.remove('hidden');
    currentSlideIndex = 0;
    showSlide(0);
}

function showSlide(index) {
    const container = document.getElementById('recap-content-area');
    const slide = recapSlides[index];

    if (!slide) return;

    let html = '';

    if (slide.type === 'top_games') {
        const cur = slide.primaryCurrency;
        let rows = '';
        let total = 0;
        slide.data.forEach((g, i) => {
            const ratio = Math.round((g.primary / slide.totalRef) * 100);
            const otherCurrencies = Object.entries(g.totals)
                .filter(([c]) => c !== cur)
                .map(([c, a]) => `${c}${a.toLocaleString()}`)
                .join(' / ');
            const subText = otherCurrencies ? `<div style="font-size:0.75em;color:#888;">+ ${otherCurrencies}</div>` : '';
            rows += `
                <div class="receipt-row">
                    <span class="name">${i + 1}. ${g.game}${subText}</span>
                    <span class="price">${cur}${g.primary.toLocaleString()} <span style="color:#888;font-size:0.85em;">(${ratio}%)</span></span>
                </div>`;
            total += g.primary;
        });
        html = generateReceiptHTML(slide.title, rows, total, slide.primaryCurrency, true);
    }
    else if (slide.type === 'monthly_timeline') {
        const cur = slide.primaryCurrency;
        let rows = '';
        let total = 0;
        for (let m = 1; m <= 12; m++) {
            if (slide.data[m] && slide.data[m].length > 0) {
                let monthTotal = 0;
                slide.data[m].forEach(item => monthTotal += item.price);
                rows += `<div class="receipt-month-header">- ${m}월 (${cur}${monthTotal.toLocaleString()}) -</div>`;
                slide.data[m].forEach(item => {
                    rows += `
                        <div class="receipt-row">
                            <span class="name" style="font-size:0.85em;">${item.name}</span>
                            <span class="price">${cur}${item.price.toLocaleString()}</span>
                        </div>`;
                });
                total += monthTotal;
            }
        }
        html = generateReceiptHTML(slide.title, rows, total, cur, true);
    }
    else if (slide.type === 'max_month_receipt') {
        const cur = slide.primaryCurrency;
        let rows = '';
        slide.items.forEach(item => {
            rows += `
                <div class="receipt-row">
                    <span class="name" style="font-size:0.9em;">${item.name}</span>
                    <span class="price">${cur}${item.price.toLocaleString()}</span>
                </div>`;
        });
        html = `
            <div class="slide-content fade-in-up">
                <div class="receipt-paper long-receipt" style="border: 2px solid #ff7675;">
                    <h3 style="color:#d63031">${slide.title}</h3>
                    <p style="text-align:center; font-size:0.9em; color:#555; margin-bottom:10px;">지름신 강림의 현장</p>
                    <div class="receipt-line">----------------</div>
                    <div class="receipt-body scrollable-body" style="max-height: 250px;">${rows}</div>
                    <div class="receipt-line">----------------</div>
                    <div class="receipt-total" style="color:#d63031">
                        <span>총 지출</span>
                        <span>${cur}${slide.amount.toLocaleString()}</span>
                    </div>
                </div>
            </div>
        `;
    }
    else {
        html = slide.content;
    }

    if (slide.type !== 'outro') {
        html += `<button class="next-btn" id="next-slide-btn">다음 ▶</button>`;
    }

    container.innerHTML = html;

    if (slide.type === 'total') {
        animateValue("total-amount", 0, slide.amount, slide.currency, 2000);
    }

    const nextBtn = document.getElementById('next-slide-btn');
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            currentSlideIndex++;
            showSlide(currentSlideIndex);
        });
    }
}

function generateReceiptHTML(title, rows, total, currency, isScrollable = false) {
    const scrollClass = isScrollable ? 'long-receipt' : '';
    const bodyClass = isScrollable ? 'scrollable-body' : '';

    return `
        <div class="slide-content fade-in-up">
            <div class="receipt-paper ${scrollClass}">
                <h3>${title}</h3>
                <div class="receipt-line">----------------</div>
                <div class="receipt-body ${bodyClass}">${rows}</div>
                <div class="receipt-line">----------------</div>
                <div class="receipt-total">
                    <span>합계</span>
                    <span>${currency}${total.toLocaleString()}</span>
                </div>
                <div class="barcode">||| || ||| | ||||</div>
            </div>
        </div>
    `;
}

function animateValue(id, start, end, currency, duration) {
    const obj = document.getElementById(id);
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
        const value = Math.floor(ease * (end - start) + start);
        obj.innerHTML = currency + value.toLocaleString();
        if (progress < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
}

// --- 3. 영수증 이미지 저장 ---
window.downloadLongReceipt = function() {
    const timelineSlide = recapSlides.find(s => s.type === 'monthly_timeline');
    if (!timelineSlide) {
        alert("저장할 데이터가 없습니다.");
        return;
    }

    const cur = timelineSlide.primaryCurrency;

    let rows = '';
    let total = 0;
    const data = timelineSlide.data;

    for (let m = 1; m <= 12; m++) {
        if (data[m] && data[m].length > 0) {
            let monthTotal = 0;
            data[m].forEach(item => monthTotal += item.price);
            rows += `<div class="receipt-month-header">- ${m}월 (${cur}${monthTotal.toLocaleString()}) -</div>`;
            data[m].forEach(item => {
                rows += `
                    <div class="receipt-row">
                        <span class="name" style="font-size:0.85em;">${item.name}</span>
                        <span class="price">${cur}${item.price.toLocaleString()}</span>
                    </div>`;
            });
            total += monthTotal;
        }
    }

    const headerLabel = timelineSlide.isInProgress
        ? `${timelineSlide.year}년 ${timelineSlide.scopeLabel} 중간 결산`
        : `${timelineSlide.year}년 ${timelineSlide.scopeLabel} 결산`;
    const totalLabel = timelineSlide.isInProgress ? '누적 합계' : '연간 합계';

    const receiptHTML = `
        <div id="temp-capture-area" style="position:fixed; top:-9999px; left:0; width: 400px; background-color:#2d3436; padding: 20px; font-family: 'Galmuri11', sans-serif;">
            <div class="receipt-paper" style="box-shadow:none; margin:0 auto; transform:none;">
                <h3 style="text-align:center; font-weight:bold; margin-bottom:10px; border-bottom:2px dashed #333; padding-bottom:10px;">
                    ${headerLabel}
                </h3>
                <div class="receipt-body" style="overflow:visible; max-height:none;">
                    ${rows}
                </div>
                <div class="receipt-line" style="border-top:1px dashed #aaa; margin:10px 0;"></div>
                <div class="receipt-total" style="display:flex; justify-content:space-between; font-weight:bold; font-size:1.1em;">
                    <span>${totalLabel}</span>
                    <span>${cur}${total.toLocaleString()}</span>
                </div>
                <div class="barcode" style="font-family:'Libre Barcode 39'; font-size:2em; text-align:center; margin-top:20px;">||| || ||| | ||||</div>

                <div style="text-align:center; margin-top:15px; border-top:1px dotted #ccc; padding-top:10px;">
                    <div style="font-size:0.8em; color:#555; font-weight:bold;">Sort Orders · 결제 정리함</div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', receiptHTML);
    const elementToCapture = document.getElementById('temp-capture-area');

    html2canvas(elementToCapture, {
        backgroundColor: "#2d3436",
        scale: 2
    }).then(canvas => {
        const link = document.createElement('a');
        link.download = `recap_${timelineSlide.captureScope}_${timelineSlide.year}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();

        document.body.removeChild(elementToCapture);
    }).catch(err => {
        console.error(err);
        alert("이미지 저장 중 오류가 발생했습니다.");
        document.body.removeChild(elementToCapture);
    });
};
