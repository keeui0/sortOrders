// 게임 분류 키워드.
// `getAppName(title, publisher)`는 이 객체의 선언 순서대로 첫 번째 매칭을 반환합니다.
// 따라서 더 구체적/특수한 게임은 일반 키워드를 가진 게임보다 앞에 두는 것이 안전합니다.
// 매칭은 대소문자 구분 + substring 방식이므로 짧은 키워드(예: '니케', '명조')는
// 의도치 않은 매칭을 일으킬 수 있어 가능하면 정식 명칭을 함께 등록해두세요.
let appKeywords = {
    // --- HoYoverse / miHoYo ---
    '원신': ['원신', 'Genshin Impact'],
    '붕괴: 스타레일': ['붕괴: 스타레일', '붕괴:스타레일', '붕괴스타레일', 'Honkai: Star Rail', 'HonkaiStarRail'],
    '붕괴3rd': ['붕괴3rd', '붕괴 3rd', '붕괴3', '붕괴 3', 'Honkai Impact 3rd', 'Honkai Impact 3'],
    '젠레스 존 제로': ['젠레스 존 제로', '젠레스존제로', 'Zenless Zone Zero', 'ZenlessZoneZero'],

    // --- 트릭컬 (글로벌이 영어 'Trickcal' 키워드를 가지므로 한국 서버를 앞에 두어 영어 타이틀 가로채기 방지) ---
    '트릭컬 리바이브': ['트릭컬 리바이브', '트릭컬', 'Trickcal Revive'],
    '트릭컬 글로벌 서버': ['Trickcal:Chibi Go', 'トリッカル:もちもちほっぺ大作戦', 'Trickcal'],

    // --- 쿠키런 시리즈 (둘 다 '쿠키런'으로 시작하므로 bare '쿠키런' 키워드는 절대 추가하지 말 것) ---
    '쿠키런: 킹덤': ['쿠키런: 킹덤', '쿠키런:킹덤', '쿠키런 킹덤', '쿠키런킹덤', 'CookieRun: Kingdom'],
    '쿠키런: 오븐브레이크': ['쿠키런: 오븐브레이크', '쿠키런:오븐브레이크', '쿠키런 오븐브레이크', '쿠키런오븐브레이크', 'CookieRun: OvenBreak'],

    // --- Yu-Gi-Oh! ---
    'Yu-Gi-Oh! Master Duel': ['Yu-Gi-Oh! Master Duel', '유희왕 마스터 듀얼', '유희왕마스터듀얼'],
    'Yu-Gi-Oh! Duel Links': ['Yu-Gi-Oh! Duel Links', '유희왕 듀얼링크스', '유희왕 듀얼 링크스', '유희왕듀얼링크스'],

    // --- Pokémon ---
    'Pokémon GO': ['Pokémon GO', 'Pokemon GO', '포켓몬 GO', '포켓몬고'],
    'Pokémon Sleep': ['Pokémon Sleep', 'Pokemon Sleep', '포켓몬 Sleep', '포켓몬슬립'],
    '포켓몬 카드 게임 Pocket': ['포켓몬 카드 게임 Pocket', '포켓몬 카드 게임', '포켓몬카드게임', 'Pokémon TCG', 'Pokémon TCG Pocket'],

    // --- 기타 모바일 게임 (한국 출시명 기준) ---
    '명조:워더링 웨이브': ['명조:워더링 웨이브', '명조', 'Wuthering Waves'],
    '블루 아카이브': ['블루 아카이브', 'Blue Archive', 'ブルーアーカイブ'],
    '명일방주': ['명일방주', '아크나이츠', 'Arknights'],
    '승리의 여신: 니케': ['승리의 여신: 니케', '승리의 여신:니케', '니케', 'GODDESS OF VICTORY: NIKKE', 'NIKKE'],
    '우마무스메 프리티 더비': ['우마무스메 프리티 더비', '우마무스메: 프리티 더비', '우마무스메프리티더비', '우마무스메', 'Uma Musume'],
    '리버스: 1999': ['리버스: 1999', '리버스:1999', '리버스 1999', '리버스1999', 'REVERSE: 1999', 'REVERSE:1999', 'REVERSE 1999'],
    '소녀전선2: 망명': ['소녀전선2: 망명', '소녀전선2 망명', '소녀전선 망명', '소녀전선2', '소녀전선 2', 'Girls Frontline 2'],
    '브라운더스트2': ['브라운더스트2', '브라운더스트 2', '브라운더스트II', '브라운더스트 II', 'BrownDust 2', 'BrownDust II'],
    '프린세스 커넥트! Re:Dive': ['프린세스 커넥트! Re:Dive', '프린세스커넥트!Re:Dive', '프린세스 커넥트', '프린세스커넥트', 'Princess Connect'],
    '페이트/그랜드 오더': ['페이트/그랜드 오더', '페그오', 'Fate/Grand Order', 'FGO'],
    '에픽세븐': ['에픽세븐', '에픽 세븐', 'Epic Seven', 'EpicSeven', 'E7'],
    '가디언 테일즈': ['가디언 테일즈', 'Guardian Tales'],
    '마비노기 모바일': ['마비노기 모바일', '마비노기M', 'Mabinogi Mobile'],
    '에버소울': ['에버소울', '에버 소울', 'Eversoul'],
    '벽람항로': ['벽람항로', 'Azur Lane', 'アズールレーン'],
    '헤븐 번즈 레드': ['헤븐 번즈 레드', '헤븐번즈레드', 'Heaven Burns Red'],
    '프로젝트 세카이 컬러풀 스테이지! feat. 하츠네 미쿠': ['프로젝트 세카이 컬러풀 스테이지! feat. 하츠네 미쿠', '프로젝트세카이컬러풀스테이지!feat.하츠네미쿠', '프로젝트 세카이', 'Project Sekai: Colorful Stage! feat. Hatsune Miku', 'Project Sekai'],
    'SD건담 지 제네레이션 이터널': ['SD건담 지 제네레이션 이터널', 'SD건담지제네레이션이터널', 'SD Gundam G Generation Eternal'],
    '신월동행': ['신월동행', '신월 동행', 'New Moon Companion'],
    'Limbus Company': ['Limbus Company', '림버스 컴퍼니', '림버스컴퍼니'],
    '로스트 소드': ['로스트 소드', 'Lost Sword'],
    '크루세이더 퀘스트': ['크루세이더 퀘스트', '크루세이더퀘스트', 'Crusaders Quest'],
    '월드 플리퍼': ['월드 플리퍼', '월드플리퍼', 'World Flipper'],
    '스카이 킹덤：드래곤 에이지': ['스카이 킹덤：드래곤 에이지', '스카이 킹덤', 'Sky Kingdom: Dragon Age'],

    // --- 짧거나 일반어성 키워드라 다른 게임명에 끼어들 위험이 있는 항목 ---
    // 'Valkyrie' / '발키리'는 다른 게임에도 자주 쓰이므로 정식명을 함께 매칭하도록 둠
    'Valkyrie Connect': ['Valkyrie Connect', '발키리 커넥트', '발키리커넥트'],
    // '레조넌스'는 일반 단어라 비슷한 이름의 다른 앱과 충돌 가능 — 영문명 함께 등록
    '레조넌스': ['레조넌스', 'Resonance'],
    'Merge Mansion': ['Merge Mansion', '머지 맨션'],
    'Monster Hunter Now': ['Monster Hunter Now', '몬스터 헌터 나우', '몬헌 나우', '몬헌나우'],
    'Shadowverse: Worlds Beyond': ['Shadowverse: Worlds Beyond', 'Shadowverse', '섀도우버스: 월즈 비욘드', '섀도우버스'],
    '하스스톤': ['하스스톤', 'Hearthstone'],
    'Arcaea': ['Arcaea', '아케아']
};
