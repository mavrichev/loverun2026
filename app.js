const HM_DATA_URL = "dashboard_compact.json";
const SEVEN_K_DATA_URL = "dashboard_7k_compact.json";
const TILE_URL = "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png";
const TILE_ATTRIBUTION =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
const COMPARE_COLORS = ["#00b8a9", "#74a8ff", "#f0b348", "#c36dff"];

const EVENT_CONFIGS = {
    hm: { key: "hm", label: "Half Marathon", dataUrl: HM_DATA_URL },
    "7k": { key: "7k", label: "7K", dataUrl: SEVEN_K_DATA_URL },
};

const state = {
    events: {},
    allRunnersByPk: new Map(),
    visibleEventKeys: ["hm", "7k"],
    activeEventKey: "hm",
    selectedRunnerPk: null,
    compareRunnerPks: [],
    currentReplaySeconds: 0,
    maxReplaySeconds: 0,
    replaySpeed: 45,
    replayPlaying: false,
    animationFrame: null,
    lastAnimationFrameAt: 0,
    map: null,
    mapReady: false,
    chartHitLines: [],
    hoveredChartRunnerPk: null,
    autoplayFired: false,
};

const dom = {};
const numberFormatter = new Intl.NumberFormat("en-US");

document.addEventListener("DOMContentLoaded", init);

async function init() {
    cacheDom();
    bindStaticEvents();

    try {
        await loadData();
    } catch (error) {
        console.error(error);
        dom.mapFallback.classList.add("visible");
        dom.mapFallback.innerHTML =
            "Dashboard data did not load. Serve the project over HTTP and refresh the page.";
        return;
    }

    prepareData();
    syncReplayControls();
    renderEventToggle();
    renderActiveRunner();
    renderStats();
    renderChartControls();
    renderChart();
    initMap();
    drawMapOverlay();

    window.addEventListener("resize", handleResize);

    const mapFrame = dom.raceMap.closest(".map-frame");
    const autoplayObserver = new IntersectionObserver(
        ([entry]) => {
            if (entry.isIntersecting && !state.autoplayFired) {
                autoplayObserver.disconnect();
                startAutoplayCountdown();
            }
        },
        { threshold: 0.5 }
    );
    autoplayObserver.observe(mapFrame);
}

function cacheDom() {
    dom.runnerSearchInput = document.getElementById("runnerSearchInput");
    dom.runnerSearchResults = document.getElementById("runnerSearchResults");
    dom.clearRunnerSelection = document.getElementById("clearRunnerSelection");
    dom.eventToggle = document.getElementById("eventToggle");
    dom.eventStatsTitle = document.getElementById("eventStatsTitle");
    dom.eventStatsGrid = document.getElementById("eventStatsGrid");
    dom.runnerStatsBlock = document.getElementById("runnerStatsBlock");
    dom.runnerStatsTitle = document.getElementById("runnerStatsTitle");
    dom.runnerStatsGrid = document.getElementById("runnerStatsGrid");

    dom.mapClock = document.getElementById("mapClock");
    dom.mapStarted = document.getElementById("mapStarted");
    dom.mapActive = document.getElementById("mapActive");
    dom.mapFinished = document.getElementById("mapFinished");
    dom.raceMap = document.getElementById("raceMap");
    dom.mapOverlay = document.getElementById("mapOverlay");
    dom.mapFallback = document.getElementById("mapFallback");
    dom.mapCountdown = document.getElementById("mapCountdown");
    dom.playToggle = document.getElementById("playToggle");
    dom.replaySlider = document.getElementById("replaySlider");
    dom.replayClock = document.getElementById("replayClock");
    dom.maxClock = document.getElementById("maxClock");
    dom.replaySpeed = document.getElementById("replaySpeed");

    dom.chartModeNote = document.getElementById("chartModeNote");
    dom.compareSearchInput = document.getElementById("compareSearchInput");
    dom.compareSearchResults = document.getElementById("compareSearchResults");
    dom.compareChips = document.getElementById("compareChips");
    dom.compareDisabled = document.getElementById("compareDisabled");
    dom.positionChart = document.getElementById("positionChart");
    dom.chartTooltip = document.getElementById("chartTooltip");
}

function bindStaticEvents() {
    dom.runnerSearchInput.addEventListener("input", () => {
        renderRunnerSearchResults();
    });

    dom.runnerSearchInput.addEventListener("focus", () => {
        renderRunnerSearchResults();
    });

    dom.runnerSearchInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            const firstResult = findSearchCandidates(
                dom.runnerSearchInput.value,
                new Set(),
                1
            )[0];
            if (firstResult) {
                event.preventDefault();
                setFocusedRunner(firstResult.pk);
            }
        } else if (event.key === "Escape") {
            hideSearchResults(dom.runnerSearchResults);
        }
    });

    dom.clearRunnerSelection.addEventListener("click", () => {
        setFocusedRunner(null);
    });

    dom.playToggle.addEventListener("click", () => {
        state.autoplayFired = true;
        toggleReplay();
    });
    dom.replaySlider.addEventListener("input", () => {
        state.autoplayFired = true;
        pauseReplay();
        state.currentReplaySeconds = Number(dom.replaySlider.value);
        updateReplayUi();
        drawMapOverlay();
    });
    dom.replaySpeed.addEventListener("change", () => {
        state.autoplayFired = true;
        state.replaySpeed = Number(dom.replaySpeed.value);
    });

    dom.compareSearchInput.addEventListener("input", () => {
        renderCompareSearchResults();
    });

    dom.compareSearchInput.addEventListener("focus", () => {
        renderCompareSearchResults();
    });

    dom.compareSearchInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            const firstResult = getCompareCandidates(1)[0];
            if (firstResult) {
                event.preventDefault();
                addCompareRunner(firstResult.pk);
            }
        } else if (event.key === "Escape") {
            hideSearchResults(dom.compareSearchResults);
        }
    });

    document.addEventListener("click", (event) => {
        if (!event.target.closest("[data-search-root='runner']")) {
            hideSearchResults(dom.runnerSearchResults);
        }
        if (!event.target.closest("[data-search-root='compare']")) {
            hideSearchResults(dom.compareSearchResults);
        }
    });

    dom.positionChart.addEventListener("mousemove", handleChartHover);
    dom.positionChart.addEventListener("mouseleave", () => {
        if (state.hoveredChartRunnerPk) {
            state.hoveredChartRunnerPk = null;
            dom.chartTooltip.style.display = "none";
            renderChart();
        }
    });
    dom.positionChart.addEventListener("click", () => {
        if (!state.hoveredChartRunnerPk) return;
        if (getFocusedRunner()) return;
        setFocusedRunner(state.hoveredChartRunnerPk);
    });

    dom.eventToggle.addEventListener("click", (event) => {
        const btn = event.target.closest("[data-events]");
        if (!btn) return;
        setVisibleEvents(btn.dataset.events.split(","));
    });

    document.getElementById("seeMyResult").addEventListener("click", (e) => {
        e.preventDefault();
        setFocusedRunner(8748416);
        renderAll();
        document.querySelector(".search-field").scrollIntoView({ behavior: "smooth" });
    });
}

async function loadData() {
    const results = await Promise.all(
        Object.values(EVENT_CONFIGS).map(async (config) => {
            const response = await fetch(config.dataUrl);
            if (!response.ok) {
                throw new Error(`Failed to load ${config.dataUrl}: ${response.status}`);
            }
            return { key: config.key, data: await response.json() };
        })
    );

    for (const { key, data } of results) {
        state.events[key] = {
            key,
            label: EVENT_CONFIGS[key].label,
            data,
            runners: [],
            sortedRunners: [],
            runnerByPk: new Map(),
            divisionCounts: new Map(),
            genderCounts: new Map(),
            coursePoints: [],
            courseCumulativeMiles: [],
            coursePolylineMiles: 0,
        };
    }
}

function prepareData() {
    state.allRunnersByPk = new Map();

    for (const [eventKey, evt] of Object.entries(state.events)) {
        evt.runners = evt.data.runners.map((runner) => {
            const genderKey = runner.gender || "U";
            const searchText = `${runner.name} ${runner.bib} ${runner.division}`.toLowerCase();
            const firstChartPlace = runner.places.find((place) => place != null) || runner.overallPlace;
            const allPlaces = [...runner.places.filter((place) => place != null), runner.overallPlace];
            return {
                ...runner,
                eventKey,
                genderKey,
                searchText,
                firstChartPlace,
                chartMinPlace: Math.min(...allPlaces),
                chartMaxPlace: Math.max(...allPlaces),
            };
        });

        evt.sortedRunners = [...evt.runners].sort((a, b) => a.overallPlace - b.overallPlace);
        evt.runnerByPk = new Map(evt.runners.map((runner) => [String(runner.pk), runner]));

        for (const runner of evt.runners) {
            evt.genderCounts.set(
                runner.genderKey,
                (evt.genderCounts.get(runner.genderKey) || 0) + 1
            );
            evt.divisionCounts.set(
                runner.division,
                (evt.divisionCounts.get(runner.division) || 0) + 1
            );
            state.allRunnersByPk.set(String(runner.pk), runner);
        }

        buildCourseGeometry(evt);
    }

    state.maxReplaySeconds = Math.max(
        ...Object.values(state.events).map((evt) => evt.data.meta.maxReplaySeconds)
    );
}

function buildCourseGeometry(evt) {
    evt.coursePoints = evt.data.course.points.map(([lat, lng]) => ({ lat, lng }));
    evt.courseCumulativeMiles = [0];
    let total = 0;
    for (let index = 1; index < evt.coursePoints.length; index += 1) {
        total += haversineMiles(evt.coursePoints[index - 1], evt.coursePoints[index]);
        evt.courseCumulativeMiles.push(total);
    }
    evt.coursePolylineMiles = total;
}

function setVisibleEvents(keys) {
    state.visibleEventKeys = keys;

    if (state.selectedRunnerPk) {
        const runner = state.allRunnersByPk.get(String(state.selectedRunnerPk));
        if (runner && !keys.includes(runner.eventKey)) {
            setFocusedRunner(null);
            return;
        }
    }

    if (!state.selectedRunnerPk || !keys.includes(state.activeEventKey)) {
        state.activeEventKey = keys[0];
    }

    state.maxReplaySeconds = Math.max(
        ...keys.map((k) => state.events[k].data.meta.maxReplaySeconds)
    );
    if (state.currentReplaySeconds > state.maxReplaySeconds) {
        state.currentReplaySeconds = state.maxReplaySeconds;
    }

    renderEventToggle();
    syncReplayControls();
    renderStats();
    renderChartControls();
    renderChart();
    drawMapOverlay();
}

function renderEventToggle() {
    const buttons = dom.eventToggle.querySelectorAll("[data-events]");
    for (const btn of buttons) {
        const keys = btn.dataset.events.split(",");
        const isActive =
            keys.length === state.visibleEventKeys.length &&
            keys.every((k) => state.visibleEventKeys.includes(k));
        btn.classList.toggle("active", isActive);
    }
}

function getActiveEvent() {
    return state.events[state.activeEventKey];
}

function initMap() {
    if (!window.L) {
        dom.mapFallback.classList.add("visible");
        dom.mapFallback.innerHTML =
            "Leaflet did not load, so the zoomable course map is unavailable. The rest of the page still works.";
        return;
    }

    state.map = L.map(dom.raceMap, {
        zoomControl: true,
        preferCanvas: true,
        scrollWheelZoom: true,
    });

    L.tileLayer(TILE_URL, {
        attribution: TILE_ATTRIBUTION,
        subdomains: "abcd",
        maxZoom: 19,
    }).addTo(state.map);

    state.map.setView([39.959, -75.167], 15);

    state.map.on("move zoom resize load", drawMapOverlay);
    state.mapReady = true;
}

function handleResize() {
    renderChart();
    drawMapOverlay();
}

function syncReplayControls() {
    dom.replaySlider.max = String(state.maxReplaySeconds);
    dom.replaySlider.value = String(state.currentReplaySeconds);
    dom.maxClock.textContent = formatRaceTime(state.maxReplaySeconds);
    dom.replaySpeed.value = String(state.replaySpeed);
    updateReplayUi();
}

function setFocusedRunner(pk) {
    const nextPk = pk == null ? null : String(pk);
    state.selectedRunnerPk = nextPk;
    state.compareRunnerPks = [];
    state.hoveredChartRunnerPk = null;

    if (nextPk) {
        const runner = state.allRunnersByPk.get(nextPk);
        if (runner) {
            dom.runnerSearchInput.value = runner.name;
            state.activeEventKey = runner.eventKey;
        } else {
            dom.runnerSearchInput.value = "";
        }
    } else {
        dom.runnerSearchInput.value = "";
        if (!state.visibleEventKeys.includes(state.activeEventKey)) {
            state.activeEventKey = state.visibleEventKeys[0];
        }
    }

    hideSearchResults(dom.runnerSearchResults);
    hideSearchResults(dom.compareSearchResults);
    dom.compareSearchInput.value = "";

    renderEventToggle();
    renderActiveRunner();
    renderStats();
    renderChartControls();
    renderChart();
    drawMapOverlay();
}

function addCompareRunner(pk) {
    const runnerPk = String(pk);
    if (!state.selectedRunnerPk || runnerPk === state.selectedRunnerPk) return;
    if (state.compareRunnerPks.includes(runnerPk)) return;
    if (state.compareRunnerPks.length >= 4) return;

    const runner = state.allRunnersByPk.get(runnerPk);
    const focused = getFocusedRunner();
    if (!runner || !focused || runner.eventKey !== focused.eventKey) return;

    state.compareRunnerPks = [...state.compareRunnerPks, runnerPk];
    dom.compareSearchInput.value = "";
    hideSearchResults(dom.compareSearchResults);
    renderChartControls();
    renderChart();
}

function removeCompareRunner(pk) {
    state.compareRunnerPks = state.compareRunnerPks.filter((item) => item !== String(pk));
    renderChartControls();
    renderChart();
}

function renderActiveRunner() {
    const runner = getFocusedRunner();
    dom.clearRunnerSelection.hidden = !runner;
}

function renderStats() {
    const activeEvt = getActiveEvent();
    const summary = activeEvt.data.meta.summary;

    dom.eventStatsTitle.textContent = `Overall Results \u2014 ${activeEvt.label}`;

    const men = summary.men || 0;
    const women = summary.women || 0;
    const unspecified = summary.finishers - men - women;
    const finisherSub = unspecified > 0
        ? `${numberFormatter.format(women)} women \u00b7 ${numberFormatter.format(men)} men \u00b7 ${numberFormatter.format(unspecified)} unspecified`
        : `${numberFormatter.format(women)} women \u00b7 ${numberFormatter.format(men)} men`;

    renderStatCards(dom.eventStatsGrid, [
        {
            label: "Finishers",
            value: numberFormatter.format(summary.finishers),
            sub: finisherSub,
            accent: "accent-orange",
        },
        {
            label: "Winning Time",
            value: formatTime(summary.winnerSeconds),
            sub: `${escapeHtml(activeEvt.sortedRunners[0].name)} won overall`,
            accent: "accent-pink",
        },
        {
            label: "Median Time",
            value: formatTime(summary.medianSeconds),
            sub: "Midpoint of the field",
            accent: "accent-teal",
        },
        {
            label: "Average Pace",
            value: `${formatPace(summary.averagePaceSeconds)}/mi`,
            sub: summary.womenWinnerSeconds
                ? `Women's winner: ${escapeHtml(summary.womenWinnerName)} in ${formatTime(summary.womenWinnerSeconds)}`
                : "Average pace across all finishers",
            accent: "accent-gold",
        },
    ]);

    const runner = getFocusedRunner();
    if (!runner) {
        dom.runnerStatsBlock.hidden = true;
        return;
    }

    dom.runnerStatsBlock.hidden = false;

    const runnerEvt = state.events[runner.eventKey];
    const totalFinishers = runnerEvt.data.meta.summary.finishers;
    const genderCount = runnerEvt.genderCounts.get(runner.genderKey) || 0;
    const divisionCount = runnerEvt.divisionCounts.get(runner.division) || 0;

    dom.runnerStatsTitle.textContent = runner.name;
    renderStatCards(dom.runnerStatsGrid, [
        {
            label: "Chip Time",
            value: formatTime(runner.chipSeconds),
            sub: `${formatPace(runner.paceSeconds)}/mi \u00b7 gun ${formatTime(runner.gunSeconds)}`,
            accent: "accent-orange",
        },
        {
            label: "Overall Place",
            value: `#${numberFormatter.format(runner.overallPlace)}`,
            sub: `Top ${(runner.overallPlace / totalFinishers * 100).toFixed(1)}% of ${numberFormatter.format(totalFinishers)}`,
            accent: "accent-pink",
        },
        {
            label: "Gender Place",
            value: `#${numberFormatter.format(runner.genderPlace)}`,
            sub: `${numberFormatter.format(runner.genderPlace)} of ${numberFormatter.format(genderCount)} ${runner.gender === "F" ? "women" : runner.gender === "M" ? "men" : "runners"}`,
            accent: "accent-teal",
        },
        {
            label: "Division Place",
            value: `#${numberFormatter.format(runner.divisionPlace)}`,
            sub: `${numberFormatter.format(runner.divisionPlace)} of ${numberFormatter.format(divisionCount)} in ${runner.division}`,
            accent: "accent-gold",
        },
    ]);
}

function renderStatCards(container, cards) {
    container.innerHTML = cards
        .map(
            (card) => `
                <article class="stat-card ${card.accent}">
                    <div class="label">${card.label}</div>
                    <div class="value">${card.value}</div>
                    <div class="sub">${card.sub}</div>
                </article>
            `
        )
        .join("");
}

function renderRunnerSearchResults() {
    const query = dom.runnerSearchInput.value;
    const results = findSearchCandidates(query, new Set(), 8);
    renderSearchResults(dom.runnerSearchResults, results, {
        emptyText: query.trim()
            ? "No runners match that search."
            : "Type a name, bib, or division to focus one runner.",
        onSelect: (runner) => setFocusedRunner(runner.pk),
    });
}

function renderCompareSearchResults() {
    if (!state.selectedRunnerPk) {
        hideSearchResults(dom.compareSearchResults);
        return;
    }
    const results = getCompareCandidates(8);
    renderSearchResults(dom.compareSearchResults, results, {
        emptyText: dom.compareSearchInput.value.trim()
            ? "No comparison runners match that search."
            : "Add up to four additional runners to the chart.",
        onSelect: (runner) => addCompareRunner(runner.pk),
    });
}

function getCompareCandidates(limit) {
    const focused = getFocusedRunner();
    if (!focused) return [];
    const exclude = new Set([state.selectedRunnerPk, ...state.compareRunnerPks].filter(Boolean));
    return findSearchCandidates(dom.compareSearchInput.value, exclude, limit, focused.eventKey);
}

function renderSearchResults(container, results, { emptyText, onSelect }) {
    if (!results.length) {
        container.innerHTML = `<div class="search-empty">${emptyText}</div>`;
        container.classList.add("open");
        return;
    }

    const showEventLabel = state.visibleEventKeys.length > 1;

    container.innerHTML = results
        .map(
            (runner) => `
                <button class="search-result" data-runner-pk="${runner.pk}">
                    <div class="pill-dot" style="background:${getRunnerAccent(runner.pk)}"></div>
                    <div>
                        <div class="search-result-title">${escapeHtml(runner.name)}</div>
                        <div class="search-result-meta">${showEventLabel ? `${EVENT_CONFIGS[runner.eventKey].label} \u00b7 ` : ""}Bib ${runner.bib} \u00b7 ${escapeHtml(runner.division)} \u00b7 ${runner.gender || "?"}${runner.age ? ` \u00b7 age ${runner.age}` : ""}</div>
                    </div>
                    <div class="search-result-rank">#${numberFormatter.format(runner.overallPlace)}</div>
                </button>
            `
        )
        .join("");

    container.classList.add("open");
    container.querySelectorAll("[data-runner-pk]").forEach((button) => {
        button.addEventListener("click", () => {
            const runner = state.allRunnersByPk.get(button.dataset.runnerPk);
            if (runner) onSelect(runner);
        });
    });
}

function hideSearchResults(container) {
    container.classList.remove("open");
}

function renderChartControls() {
    const runner = getFocusedRunner();
    const compareAtLimit = state.compareRunnerPks.length >= 4;

    if (!runner) {
        dom.chartModeNote.textContent =
            "No runner is locked in yet, so the chart defaults to the top 100 finishers to keep the field legible.";
        dom.compareDisabled.hidden = false;
        dom.compareDisabled.textContent = "Select a focused runner to enable comparison search.";
        dom.compareSearchInput.disabled = true;
        dom.compareSearchInput.placeholder = "Select a focused runner first";
        dom.compareSearchInput.value = "";
        dom.compareChips.innerHTML = "";
        hideSearchResults(dom.compareSearchResults);
        return;
    }

    dom.chartModeNote.textContent =
        "Focused view. The y-axis expands from the tracked runners' start and finish places, with enough padding to keep their lines readable.";
    dom.compareDisabled.hidden = !compareAtLimit;
    dom.compareDisabled.textContent = "Comparison limit reached. Remove one runner to add another.";
    dom.compareSearchInput.disabled = compareAtLimit;
    dom.compareSearchInput.placeholder =
        compareAtLimit ? "Comparison limit reached" : "Add comparison runners";
    if (compareAtLimit) {
        hideSearchResults(dom.compareSearchResults);
    }

    dom.compareChips.innerHTML = state.compareRunnerPks
        .map((pk) => {
            const compareRunner = state.allRunnersByPk.get(pk);
            if (!compareRunner) return "";
            const color = getRunnerAccent(compareRunner.pk);
            return `
                <div class="compare-chip">
                    <span class="pill-dot" style="background:${color}"></span>
                    <span>${escapeHtml(compareRunner.name)}</span>
                    <button type="button" data-remove-pk="${compareRunner.pk}" aria-label="Remove ${escapeHtml(compareRunner.name)}">×</button>
                </div>
            `;
        })
        .join("");

    dom.compareChips.querySelectorAll("[data-remove-pk]").forEach((button) => {
        button.addEventListener("click", () => removeCompareRunner(button.dataset.removePk));
    });
}

function renderChart() {
    const canvas = dom.positionChart;
    const rect = canvas.parentElement.getBoundingClientRect();
    const ctx = resizeCanvas(canvas, rect.width, rect.height);
    const width = rect.width;
    const height = rect.height;
    const pad = { top: 28, right: 22, bottom: 46, left: 68 };
    const chartWidth = width - pad.left - pad.right;
    const chartHeight = height - pad.top - pad.bottom;
    const activeEvt = getActiveEvent();
    const mileMarks = activeEvt.data.meta.mileMarks;
    const selectedRunner = getFocusedRunner();

    ctx.clearRect(0, 0, width, height);

    if (!mileMarks || !mileMarks.length) return;

    const defaultView = !selectedRunner;
    const visibleRunners = defaultView
        ? activeEvt.sortedRunners.slice(0, 100)
        : [selectedRunner, ...state.compareRunnerPks.map((pk) => state.allRunnersByPk.get(pk)).filter(Boolean)];

    let yMin = 1;
    let yMax = 105;
    if (!defaultView && visibleRunners.length) {
        const startFinishMin = Math.min(
            ...visibleRunners.map((runner) => Math.min(runner.firstChartPlace, runner.overallPlace))
        );
        const startFinishMax = Math.max(
            ...visibleRunners.map((runner) => Math.max(runner.firstChartPlace, runner.overallPlace))
        );
        const actualMin = Math.min(...visibleRunners.map((runner) => runner.chartMinPlace));
        const actualMax = Math.max(...visibleRunners.map((runner) => runner.chartMaxPlace));
        yMin = Math.max(1, Math.min(actualMin, startFinishMin - 10));
        yMax = Math.max(yMin + 10, Math.max(actualMax, startFinishMax + 10));
    }

    const xMin = mileMarks[0];
    const xMax = mileMarks[mileMarks.length - 1];
    const xScale = (mile) => pad.left + ((mile - xMin) / (xMax - xMin)) * chartWidth;
    const yScale = (place) => pad.top + ((place - yMin) / (yMax - yMin)) * chartHeight;

    drawChartGrid(ctx, width, height, pad, yMin, yMax, xScale, yScale, mileMarks);

    state.chartHitLines = [];

    for (let index = 0; index < visibleRunners.length; index += 1) {
        const runner = visibleRunners[index];
        const isSelected = selectedRunner && String(runner.pk) === String(selectedRunner.pk);
        const isHovered = state.hoveredChartRunnerPk && String(runner.pk) === state.hoveredChartRunnerPk;
        const color = defaultView
            ? index === 0
                ? "#ff8b63"
                : `rgba(255, 177, 137, ${index < 10 ? 0.3 : 0.12})`
            : isSelected
                ? "#ff6a3d"
                : getRunnerAccent(runner.pk);

        const lineWidth = defaultView
            ? index === 0
                ? 2.2
                : 1.1
            : isSelected
                ? 3
                : isHovered
                    ? 2.6
                    : 2;

        const alpha = defaultView ? 1 : isSelected ? 1 : isHovered ? 0.95 : 0.82;
        const points = [];

        ctx.beginPath();
        for (let pointIndex = 0; pointIndex < mileMarks.length; pointIndex += 1) {
            const place = runner.places[pointIndex];
            if (place == null) continue;
            const x = xScale(mileMarks[pointIndex]);
            const y = yScale(place);
            points.push({
                x,
                y,
                mile: mileMarks[pointIndex],
                place,
                chipSeconds: runner.mileTimes[pointIndex],
            });
            if (points.length === 1) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }

        ctx.strokeStyle = setAlpha(color, alpha);
        ctx.lineWidth = lineWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();

        if (!defaultView || isHovered || isSelected) {
            ctx.fillStyle = color;
            for (const point of points) {
                ctx.beginPath();
                ctx.arc(point.x, point.y, isSelected ? 3.6 : 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        state.chartHitLines.push({ runner, color, points });
    }
}

function drawChartGrid(ctx, width, height, pad, yMin, yMax, xScale, yScale, mileMarks) {
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.fillStyle = "rgba(249, 241, 227, 0.56)";
    ctx.font = "12px Space Grotesk, sans-serif";
    ctx.textAlign = "right";

    const tickCount = 6;
    for (let tick = 0; tick <= tickCount; tick += 1) {
        const place = yMin + ((yMax - yMin) / tickCount) * tick;
        const y = yScale(place);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(width - pad.right, y);
        ctx.stroke();
        ctx.fillText(numberFormatter.format(Math.round(place)), pad.left - 10, y + 4);
    }

    const lastMile = mileMarks[mileMarks.length - 1];
    const xLabels = mileMarks.length <= 7
        ? mileMarks
        : mileMarks.filter((m) => {
            if (m === lastMile) return true;
            if (m % 2 !== 1) return false;
            // Skip Mi 13 when Finish (13.1) is the last label -- they overlap
            if (m === 13 && lastMile === 13.1) return false;
            return true;
        });

    ctx.textAlign = "center";
    for (const mark of xLabels) {
        const x = xScale(mark);
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, height - pad.bottom);
        ctx.strokeStyle = "rgba(255,255,255,0.04)";
        ctx.stroke();
        ctx.fillStyle = "rgba(249, 241, 227, 0.64)";
        ctx.fillText(mark === lastMile ? "Finish" : `Mi ${mark}`, x, height - pad.bottom + 18);
    }

    ctx.save();
    ctx.translate(22, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = "rgba(249, 241, 227, 0.72)";
    ctx.textAlign = "center";
    ctx.fillText("Overall Place", 0, 0);
    ctx.restore();

    ctx.fillStyle = "rgba(249, 241, 227, 0.72)";
    ctx.textAlign = "center";
    ctx.fillText("Distance", width / 2, height - 10);
}

function handleChartHover(event) {
    if (!state.chartHitLines.length) return;

    const rect = dom.positionChart.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    let closest = null;
    let closestDistance = Infinity;

    for (const line of state.chartHitLines) {
        for (const point of line.points) {
            const distance = Math.hypot(mouseX - point.x, mouseY - point.y);
            if (distance < closestDistance && distance < 18) {
                closestDistance = distance;
                closest = { line, point };
            }
        }
    }

    if (!closest) {
        if (state.hoveredChartRunnerPk) {
            state.hoveredChartRunnerPk = null;
            dom.chartTooltip.style.display = "none";
            renderChart();
        }
        return;
    }

    const hoveredPk = String(closest.line.runner.pk);
    const hoveredChanged = state.hoveredChartRunnerPk !== hoveredPk;
    state.hoveredChartRunnerPk = hoveredPk;

    const activeEvt = getActiveEvent();
    const lastMile = activeEvt.data.meta.mileMarks[activeEvt.data.meta.mileMarks.length - 1];

    dom.chartTooltip.style.display = "block";
    dom.chartTooltip.style.left = `${Math.min(mouseX + 16, rect.width - 230)}px`;
    dom.chartTooltip.style.top = `${Math.max(16, mouseY - 16)}px`;
    dom.chartTooltip.innerHTML = `
        <div class="tt-name" style="color:${closest.line.color}">${escapeHtml(closest.line.runner.name)}</div>
        <div class="tt-row"><span>Distance</span><strong>${closest.point.mile === lastMile ? "Finish" : `Mile ${closest.point.mile}`}</strong></div>
        <div class="tt-row"><span>Overall place</span><strong>#${numberFormatter.format(closest.point.place)}</strong></div>
        <div class="tt-row"><span>Chip time</span><strong>${formatTime(closest.point.chipSeconds)}</strong></div>
        <div class="tt-row"><span>Finish</span><strong>${formatTime(closest.line.runner.chipSeconds)}</strong></div>
    `;

    if (hoveredChanged) renderChart();
}

function drawMapOverlay() {
    if (!state.mapReady) {
        updateReplayUi();
        return;
    }

    const rect = dom.raceMap.getBoundingClientRect();
    const ctx = resizeCanvas(dom.mapOverlay, rect.width, rect.height);
    const width = rect.width;
    const height = rect.height;
    ctx.clearRect(0, 0, width, height);

    for (const eventKey of state.visibleEventKeys) {
        const evt = state.events[eventKey];
        const points = (eventKey === "7k" && state.visibleEventKeys.includes("hm"))
            ? evt.coursePoints.slice(40)
            : evt.coursePoints;
        const coursePixels = points.map((point) =>
            state.map.latLngToContainerPoint([point.lat, point.lng])
        );
        drawCourse(ctx, coursePixels);
    }

    const selectedRunner = getFocusedRunner();
    let selectedState = null;
    let started = 0;
    let active = 0;
    let finished = 0;

    const HM_APEX_DISTANCE = 9.33;
    const HM_COLOR_BEFORE = "#2563eb";
    const HM_COLOR_AFTER = "#7cb3ff";
    const SEVEN_K_COLOR = "#10b981";

    for (const eventKey of state.visibleEventKeys) {
        const evt = state.events[eventKey];
        for (const runner of evt.runners) {
            const raceState = getRunnerRaceState(runner, state.currentReplaySeconds);
            if (raceState.status !== "waiting") started += 1;
            if (raceState.status === "finished") finished += 1;
            if (raceState.status === "running") active += 1;

            if (selectedRunner && String(runner.pk) === String(selectedRunner.pk)) {
                selectedState = raceState;
                continue;
            }

            if (raceState.status !== "running") continue;

            if (eventKey === "hm") {
                ctx.fillStyle = raceState.distance >= HM_APEX_DISTANCE ? HM_COLOR_AFTER : HM_COLOR_BEFORE;
            } else {
                ctx.fillStyle = SEVEN_K_COLOR;
            }

            const point = projectRunnerToMap(raceState.distance, eventKey);
            ctx.beginPath();
            ctx.arc(point.x, point.y, 3.2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawStartFinishMarkers(ctx);

    if (selectedRunner) {
        const raceState = selectedState || getRunnerRaceState(selectedRunner, state.currentReplaySeconds);
        drawSelectedRunner(ctx, selectedRunner, raceState);
    }

    dom.mapStarted.innerHTML = `<strong>${numberFormatter.format(started)}</strong> started`;
    dom.mapActive.innerHTML = `<strong>${numberFormatter.format(active)}</strong> moving`;
    dom.mapFinished.innerHTML = `<strong>${numberFormatter.format(finished)}</strong> finished`;
    updateReplayUi();
}

function drawCourse(ctx, coursePixels) {
    ctx.save();
    ctx.beginPath();
    for (let index = 0; index < coursePixels.length; index += 1) {
        const point = coursePixels[index];
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
    }
    ctx.strokeStyle = "rgba(255, 106, 61, 0.18)";
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();

    ctx.beginPath();
    for (let index = 0; index < coursePixels.length; index += 1) {
        const point = coursePixels[index];
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
    }
    ctx.strokeStyle = "#ff6a3d";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
}

function drawStartFinishMarkers(ctx) {
    const firstEvt = state.events[state.visibleEventKeys[0]];
    const startPoint = state.map.latLngToContainerPoint([
        firstEvt.coursePoints[0].lat,
        firstEvt.coursePoints[0].lng,
    ]);
    drawMarker(ctx, startPoint, "#00b8a9", "Start");

    const last = firstEvt.coursePoints[firstEvt.coursePoints.length - 1];
    const finishPoint = state.map.latLngToContainerPoint([last.lat, last.lng]);
    drawMarker(ctx, finishPoint, "#f0b348", "Finish");
}

function drawMarker(ctx, point, color, label) {
    ctx.save();
    ctx.fillStyle = setAlpha(color, 0.16);
    ctx.beginPath();
    ctx.arc(point.x, point.y, 18, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = "700 12px Space Grotesk, sans-serif";
    ctx.fillStyle = "rgba(33, 24, 20, 0.78)";
    ctx.textAlign = "left";
    ctx.fillText(label.toUpperCase(), point.x + 12, point.y + 4);
    ctx.restore();
}

function drawSelectedRunner(ctx, runner, raceState) {
    const point = projectRunnerToMap(raceState.distance, runner.eventKey);
    const color = "#00b8a9";
    const label = `${runner.name} \u00b7 Bib ${runner.bib}`;
    const statusText = raceState.status === "waiting"
        ? `Starts at ${formatRaceTime(runner.delaySeconds)}`
        : raceState.status === "finished"
            ? `Finished in ${formatTime(runner.chipSeconds)}`
            : `${formatRaceTime(state.currentReplaySeconds)} race clock`;

    ctx.save();
    ctx.fillStyle = setAlpha(color, 0.22);
    ctx.beginPath();
    ctx.arc(point.x, point.y, 18, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 6.5, 0, Math.PI * 2);
    ctx.fill();

    const paddingX = 12;
    const paddingY = 10;
    const labelX = clamp(point.x + 18, 14, dom.mapOverlay.clientWidth - 260);
    const labelY = clamp(point.y - 62, 14, dom.mapOverlay.clientHeight - 70);

    ctx.font = "700 13px Space Grotesk, sans-serif";
    const titleWidth = ctx.measureText(label).width;
    ctx.font = "12px Space Grotesk, sans-serif";
    const subWidth = ctx.measureText(statusText).width;
    const boxWidth = Math.max(titleWidth, subWidth) + paddingX * 2;
    const boxHeight = 50;

    ctx.beginPath();
    ctx.moveTo(point.x + 8, point.y - 4);
    ctx.lineTo(labelX, labelY + boxHeight / 2);
    ctx.strokeStyle = setAlpha(color, 0.85);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    drawRoundedRect(ctx, labelX, labelY, boxWidth, boxHeight, 14, "rgba(24, 18, 15, 0.92)");

    ctx.fillStyle = color;
    ctx.font = "700 13px Space Grotesk, sans-serif";
    ctx.fillText(label, labelX + paddingX, labelY + 19);

    ctx.fillStyle = "rgba(249, 241, 227, 0.72)";
    ctx.font = "12px Space Grotesk, sans-serif";
    ctx.fillText(statusText, labelX + paddingX, labelY + 36);
    ctx.restore();
}

function toggleReplay() {
    if (state.replayPlaying) {
        pauseReplay();
        return;
    }

    if (state.currentReplaySeconds >= state.maxReplaySeconds) {
        state.currentReplaySeconds = 0;
    }

    state.replayPlaying = true;
    state.lastAnimationFrameAt = 0;
    dom.playToggle.innerHTML = "&#9646;&#9646;";
    state.animationFrame = requestAnimationFrame(stepReplay);
}

function startAutoplayCountdown() {
    if (state.autoplayFired) return;
    state.autoplayFired = true;

    const el = dom.mapCountdown;
    let count = 3;
    el.textContent = count;
    el.classList.add("active");

    const interval = setInterval(() => {
        count--;
        if (count > 0) {
            el.textContent = count;
        } else {
            clearInterval(interval);
            el.classList.remove("active");
            toggleReplay();
        }
    }, 700);
}

function pauseReplay() {
    state.replayPlaying = false;
    dom.playToggle.innerHTML = "&#9654;";
    if (state.animationFrame) {
        cancelAnimationFrame(state.animationFrame);
        state.animationFrame = null;
    }
}

function stepReplay(timestamp) {
    if (!state.replayPlaying) return;
    if (!state.lastAnimationFrameAt) {
        state.lastAnimationFrameAt = timestamp;
    }

    const deltaSeconds = (timestamp - state.lastAnimationFrameAt) / 1000;
    state.lastAnimationFrameAt = timestamp;
    state.currentReplaySeconds = Math.min(
        state.maxReplaySeconds,
        state.currentReplaySeconds + deltaSeconds * state.replaySpeed
    );
    dom.replaySlider.value = String(Math.round(state.currentReplaySeconds));
    drawMapOverlay();

    if (state.currentReplaySeconds >= state.maxReplaySeconds) {
        pauseReplay();
        return;
    }
    state.animationFrame = requestAnimationFrame(stepReplay);
}

function updateReplayUi() {
    dom.mapClock.innerHTML = `<strong>${formatRaceTime(state.currentReplaySeconds)}</strong>`;
    dom.replayClock.textContent = formatRaceTime(state.currentReplaySeconds);
    dom.replaySlider.value = String(Math.round(state.currentReplaySeconds));
}

function findSearchCandidates(query, excludePks, limit, eventKeyFilter) {
    const normalizedQuery = query.trim().toLowerCase();
    const digitQuery = normalizedQuery.replace(/\D/g, "");

    if (!normalizedQuery) return [];

    let pool = [];
    if (eventKeyFilter) {
        pool = state.events[eventKeyFilter].sortedRunners;
    } else {
        for (const key of state.visibleEventKeys) {
            pool = pool.concat(state.events[key].sortedRunners);
        }
    }

    return pool
        .filter((runner) => {
            if (excludePks.has(String(runner.pk))) return false;
            if (runner.searchText.includes(normalizedQuery)) return true;
            if (digitQuery && String(runner.bib).includes(digitQuery)) return true;
            return false;
        })
        .map((runner) => ({
            runner,
            score: getSearchScore(runner, normalizedQuery, digitQuery),
        }))
        .sort((left, right) => left.score - right.score || left.runner.overallPlace - right.runner.overallPlace)
        .slice(0, limit)
        .map((item) => item.runner);
}

function getSearchScore(runner, query, digitQuery) {
    const name = runner.name.toLowerCase();
    const last = runner.lastname.toLowerCase();
    const division = runner.division.toLowerCase();

    if (digitQuery && String(runner.bib) === digitQuery) return 0;
    if (name.startsWith(query)) return 1;
    if (last.startsWith(query)) return 1.1;
    if (name.includes(query)) return 2;
    if (division.startsWith(query)) return 2.4;
    if (division.includes(query)) return 2.8;
    if (digitQuery && String(runner.bib).includes(digitQuery)) return 3;
    return 4;
}

function getFocusedRunner() {
    return state.selectedRunnerPk ? state.allRunnersByPk.get(String(state.selectedRunnerPk)) || null : null;
}

function getRunnerAccent(pk) {
    const focused = getFocusedRunner();
    if (focused && String(focused.pk) === String(pk)) return "#ff6a3d";
    const compareIndex = state.compareRunnerPks.findIndex((item) => String(item) === String(pk));
    if (compareIndex >= 0) return COMPARE_COLORS[compareIndex % COMPARE_COLORS.length];
    return "#ffb189";
}

function getRunnerRaceState(runner, raceClockSeconds) {
    const checkpoints = runner.replay;
    const startTime = checkpoints[0];
    const finishTime = checkpoints[checkpoints.length - 2];
    const finishDistance = checkpoints[checkpoints.length - 1];

    if (raceClockSeconds < startTime) {
        return { status: "waiting", distance: 0 };
    }
    if (raceClockSeconds >= finishTime) {
        return { status: "finished", distance: finishDistance };
    }

    for (let pairIndex = 1; pairIndex < checkpoints.length / 2; pairIndex += 1) {
        const prevTime = checkpoints[(pairIndex - 1) * 2];
        const prevDistance = checkpoints[(pairIndex - 1) * 2 + 1];
        const nextTime = checkpoints[pairIndex * 2];
        const nextDistance = checkpoints[pairIndex * 2 + 1];

        if (raceClockSeconds <= nextTime) {
            const span = Math.max(1, nextTime - prevTime);
            const ratio = (raceClockSeconds - prevTime) / span;
            return {
                status: "running",
                distance: prevDistance + (nextDistance - prevDistance) * ratio,
            };
        }
    }

    return { status: "finished", distance: finishDistance };
}

function projectRunnerToMap(distanceMiles, eventKey) {
    const latLng = latLngAtDistance(distanceMiles, eventKey);
    return state.map.latLngToContainerPoint([latLng.lat, latLng.lng]);
}

function latLngAtDistance(distanceMiles, eventKey) {
    const evt = state.events[eventKey];
    const target = clamp(distanceMiles, 0, evt.data.course.distanceMiles);
    const scaledMiles =
        evt.coursePolylineMiles * (target / evt.data.course.distanceMiles);
    const cumulative = evt.courseCumulativeMiles;

    if (scaledMiles <= 0) return evt.coursePoints[0];
    if (scaledMiles >= cumulative[cumulative.length - 1]) {
        return evt.coursePoints[evt.coursePoints.length - 1];
    }

    let low = 0;
    let high = cumulative.length - 1;

    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (cumulative[mid] < scaledMiles) low = mid + 1;
        else high = mid;
    }

    const upperIndex = Math.max(1, low);
    const lowerIndex = upperIndex - 1;
    const lowerDistance = cumulative[lowerIndex];
    const upperDistance = cumulative[upperIndex];
    const span = Math.max(0.000001, upperDistance - lowerDistance);
    const ratio = (scaledMiles - lowerDistance) / span;
    const lower = evt.coursePoints[lowerIndex];
    const upper = evt.coursePoints[upperIndex];

    return {
        lat: lower.lat + (upper.lat - lower.lat) * ratio,
        lng: lower.lng + (upper.lng - lower.lng) * ratio,
    };
}

function resizeCanvas(canvas, width, height) {
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = Math.max(1, Math.round(width));
    const displayHeight = Math.max(1, Math.round(height));
    if (canvas.width !== displayWidth * dpr || canvas.height !== displayHeight * dpr) {
        canvas.width = displayWidth * dpr;
        canvas.height = displayHeight * dpr;
        canvas.style.width = `${displayWidth}px`;
        canvas.style.height = `${displayHeight}px`;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
}

function haversineMiles(start, end) {
    const toRad = (value) => (value * Math.PI) / 180;
    const earthRadiusMiles = 3958.7613;
    const dLat = toRad(end.lat - start.lat);
    const dLng = toRad(end.lng - start.lng);
    const lat1 = toRad(start.lat);
    const lat2 = toRad(end.lat);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * earthRadiusMiles * Math.asin(Math.sqrt(a));
}

function drawRoundedRect(ctx, x, y, width, height, radius, fillStyle) {
    ctx.save();
    ctx.fillStyle = fillStyle;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function formatTime(totalSeconds) {
    const seconds = Math.round(totalSeconds || 0);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
    }
    return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatRaceTime(totalSeconds) {
    return formatTime(totalSeconds);
}

function formatPace(totalSeconds) {
    if (totalSeconds == null) return "--";
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function setAlpha(color, alpha) {
    if (color.startsWith("rgba(") || color.startsWith("hsla(")) return color;
    const hex = color.replace("#", "");
    const full = hex.length === 3
        ? hex.split("").map((char) => char + char).join("")
        : hex;
    const red = parseInt(full.slice(0, 2), 16);
    const green = parseInt(full.slice(2, 4), 16);
    const blue = parseInt(full.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
