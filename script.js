document.addEventListener('DOMContentLoaded', () => {
    // --- Caching DOM Elements for performance ---
    const getElement = (id) => document.getElementById(id);
    const screens = {
        splash: getElement('splash-screen'),
        mainMenu: getElement('main-menu'),
        songSelect: getElement('song-select-screen'),
        game: getElement('game-container'),
        loading: getElement('loading-screen'),
        pause: getElement('pause-menu'),
        results: getElement('results-screen'),
    };
    const gameElements = {
        background: getElement('game-background'),
        songCount: getElement('song-count'),
        songList: getElement('song-list'),
        albumArt: getElement('album-art'),
        songTitle: getElement('game-song-title'),
        songArtist: getElement('game-song-artist'),
        score: getElement('score'),
        multiplier: getElement('multiplier'),
        combo: getElement('combo'),
        rockMeterFill: getElement('rock-meter-fill'),
        starPowerFill: getElement('star-power-fill'),
        noteContainer: getElement('note-container'),
        highway: getElement('highway'),
        feedbackContainer: getElement('feedback-container'),
        frets: document.querySelectorAll('.fret'),
        loadingText: getElement('loading-text'),
        resultsSongInfo: getElement('results-song-info'),
        resultsScore: getElement('results-score'),
        resultsNotesHit: getElement('results-notes-hit'),
        resultsTotalNotes: getElement('results-total-notes'),
        resultsAccuracy: getElement('results-accuracy'),
        resultsMaxCombo: getElement('results-max-combo'),
    };
    const buttons = {
        playSetlist: getElement('play-setlist-btn'),
        backToMenu: getElement('back-to-menu-btn'),
        resume: getElement('resume-btn'),
        quit: getElement('quit-btn'),
        resultsBack: getElement('results-back-btn'),
    };

    // --- Game State & Configuration ---
    let songs = [];
    let gameState = 'splash';
    let audioPlayers = null;
    let gameLoopId = null;

    // --- Gameplay Variables ---
    let score, combo, maxCombo, notesHit, multiplier, rockMeter, starPower, totalNotes;
    let isStarPowerActive = false;
    let heldFrets = [false, false, false, false, false];
    let activeSustain = [null, null, null, null, null];

    const SETLIST_URL = 'setlist.json';
    const NOTE_FALL_DURATION_S = 1.5;
    const HIT_WINDOW_S = 0.09; // 90ms timing window
    const KEY_MAPPING = { 'a': 0, 's': 1, 'd': 2, 'k': 3, 'l': 4, ' ': 'sp' };
    const FRET_COLORS = ['green', 'red', 'yellow', 'blue', 'orange'];
    const MULTIPLIER_STAGES = [1, 2, 3, 4];
    const NOTES_PER_MULTIPLIER = 10;
    
    // --- Core Game Flow & Screen Navigation ---
    function navigateTo(screenName) {
        Object.values(screens).forEach(s => s.classList.remove('active'));
        if (screens[screenName]) {
            screens[screenName].classList.add('active');
        }
        gameState = screenName;
    }

    async function initialize() {
        screens.splash.addEventListener('click', async () => {
            await Tone.start();
            console.log("AudioContext started.");
            navigateTo('mainMenu');
        }, { once: true });
        
        buttons.playSetlist.addEventListener('click', loadSetlist);
        buttons.backToMenu.addEventListener('click', () => navigateTo('mainMenu'));
        buttons.quit.addEventListener('click', () => quitGame(false));
        buttons.resume.addEventListener('click', resumeGame);
        buttons.resultsBack.addEventListener('click', () => {
            renderSongList();
            navigateTo('songSelect');
        });

        setupInputListeners();
    }

    // --- Setlist & Song Parsing ---
    async function loadSetlist() {
        navigateTo('loading');
        gameElements.loadingText.textContent = 'Fetching online setlist...';
        try {
            const response = await fetch(SETLIST_URL);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const setlist = await response.json();
            gameElements.loadingText.textContent = `Loading ${setlist.length} song(s)...`;
            
            const songPromises = setlist.map(parseSongData);
            const loadedSongs = (await Promise.all(songPromises)).filter(Boolean);
            
            songs = loadedSongs;
            if (songs.length > 0) {
                 gameElements.songCount.textContent = `${songs.length} song${songs.length > 1 ? 's' : ''} loaded`;
                 renderSongList();
                 navigateTo('songSelect');
            } else {
                throw new Error("No valid songs could be loaded from the setlist.");
            }
        } catch (error) {
            console.error("Could not load setlist:", error);
            gameElements.songCount.textContent = 'Error loading setlist.';
            navigateTo('mainMenu');
        }
    }

    async function parseSongData(songEntry) {
        try {
            const [chartText, iniText] = await Promise.all([
                fetch(songEntry.chartUrl).then(res => res.ok ? res.text() : Promise.reject(`Chart fetch failed: ${res.status}`)),
                fetch(songEntry.iniUrl).then(res => res.ok ? res.text() : '')
            ]);

            const chartData = parseChart(chartText);
            const iniData = parseIni(iniText);
            
            // If no tracks were parsed successfully, this song is invalid.
            if(Object.keys(chartData.availableParts).length === 0) {
                console.warn(`No playable tracks found for "${songEntry.name}". Skipping.`);
                return null;
            }

            return { ...songEntry, ...iniData, ...chartData };
        } catch (error) {
            console.error(`Failed to parse song data for "${songEntry.name}":`, error);
            return null;
        }
    }

    function parseIni(text) {
        const data = {};
        if (!text) return data;
        const lines = text.split(/\r?\n/);
        let inSongSection = false;
        for (const line of lines) {
            if (line.trim().toLowerCase() === '[song]') { inSongSection = true; continue; }
            if (line.trim().startsWith('[')) { inSongSection = false; continue; }
            if (inSongSection) {
                const parts = line.split('=').map(s => s.trim());
                if (parts.length === 2) data[parts[0].toLowerCase()] = parts[1];
            }
        }
        return data;
    }

    function parseChart(chartText) {
        const notesByTrack = {};
        const availableParts = {};
        const lines = chartText.split(/\r?\n/);
        
        let resolution = 192;
        const syncTrack = [];
        const tempNotes = {};

        const partMapping = {
            '[ExpertSingle]': 'Guitar - Expert', '[HardSingle]': 'Guitar - Hard',
            '[MediumSingle]': 'Guitar - Medium', '[EasySingle]': 'Guitar - Easy',
            '[ExpertBass]': 'Bass - Expert', '[HardBass]': 'Bass - Hard',
            '[MediumBass]': 'Bass - Medium', '[EasyBass]': 'Bass - Easy'
        };

        let currentSection = '';
        lines.forEach(line => {
            line = line.trim();
            if (line.startsWith('[') && line.endsWith(']')) {
                currentSection = line;
                if (partMapping[currentSection] && !tempNotes[currentSection]) {
                    tempNotes[currentSection] = [];
                }
            } else if (line.includes('=')) {
                const [key, val] = line.split('=').map(s => s.trim());
                if (currentSection === '[Song]' && key.toLowerCase() === 'resolution') resolution = parseFloat(val);
                if (currentSection === '[SyncTrack]') {
                    const [tick, type, value] = key.split(' ').filter(Boolean);
                    if (type === 'B') syncTrack.push({ tick: parseInt(tick), bpm: parseInt(value) / 1000 });
                } else if (tempNotes[currentSection]) {
                    const [tick, type, data1] = key.split(' ').filter(Boolean);
                    if (type === 'N') tempNotes[currentSection].push({ type: 'note', tick: parseInt(tick), fret: parseInt(data1), durationTicks: parseInt(val) });
                    if (type === 'S' && data1 === '2') tempNotes[currentSection].push({ type: 'star', tick: parseInt(tick), durationTicks: parseInt(val) });
                }
            }
        });

        syncTrack.sort((a, b) => a.tick - b.tick);
        let time = 0, lastTick = 0, lastBpm = syncTrack[0]?.bpm || 120;
        const timeMap = [{ tick: 0, time: 0, bpm: lastBpm }];
        syncTrack.forEach(event => {
            time += ((event.tick - lastTick) / resolution) * (60 / lastBpm);
            timeMap.push({ tick: event.tick, time, bpm: event.bpm });
            lastTick = event.tick;
            lastBpm = event.bpm;
        });

        const ticksToSeconds = (ticks) => {
            const lastEvent = timeMap.filter(e => e.tick <= ticks).pop();
            return lastEvent.time + ((ticks - lastEvent.tick) / resolution) * (60 / lastEvent.bpm);
        };

        Object.keys(tempNotes).forEach(sectionKey => {
            const trackName = partMapping[sectionKey];
            if (!trackName) return;

            const starPhrases = tempNotes[sectionKey].filter(n => n.type === 'star');
            const finalNotes = tempNotes[sectionKey]
                .filter(n => n.type === 'note' && n.fret <= 4)
                .map(note => ({
                    ...note,
                    time: ticksToSeconds(note.tick),
                    duration: ticksToSeconds(note.tick + note.durationTicks) - ticksToSeconds(note.tick),
                    isStar: starPhrases.some(sp => note.tick >= sp.tick && note.tick < (sp.tick + sp.durationTicks))
                })).sort((a, b) => a.time - b.time);

            if (finalNotes.length > 0) {
                notesByTrack[trackName] = finalNotes;
                const [instrument, difficulty] = trackName.split(' - ');
                if (!availableParts[instrument]) availableParts[instrument] = [];
                availableParts[instrument].push(difficulty);
            }
        });
        
        return { notesByTrack, availableParts };
    }

    // --- UI Rendering ---
    function renderSongList() {
        gameElements.songList.innerHTML = '';
        songs.sort((a, b) => (a.name || 'Z').localeCompare(b.name || 'Z')).forEach((song) => {
            const songContainer = document.createElement('div');
            songContainer.className = 'song-item-container';
            
            const songInfo = document.createElement('div');
            songInfo.className = 'song-item';
            songInfo.innerHTML = `<b>${song.name}</b><br><small>${song.artist || 'Unknown Artist'}</small>`;
            
            const difficultyContainer = document.createElement('div');
            difficultyContainer.className = 'difficulty-container';

            Object.entries(song.availableParts).forEach(([instrument, difficulties]) => {
                ['Expert', 'Hard', 'Medium', 'Easy'].forEach(difficulty => {
                     if (difficulties.includes(difficulty)) {
                        const btn = document.createElement('button');
                        btn.className = 'difficulty-btn';
                        btn.textContent = `${instrument.charAt(0)} - ${difficulty}`;
                        btn.onclick = (e) => {
                            e.stopPropagation(); // Prevent container click
                            startGame(song, `${instrument} - ${difficulty}`);
                        };
                        difficultyContainer.appendChild(btn);
                     }
                });
            });
            
            songContainer.appendChild(songInfo);
            songContainer.appendChild(difficultyContainer);
            gameElements.songList.appendChild(songContainer);
        });
    }

    // --- GAMEPLAY ---
    async function startGame(songData, trackKey) {
        navigateTo('loading');
        gameElements.loadingText.textContent = 'Loading Audio...';
        gameElements.background.style.backgroundImage = `url('${songData.backgroundUrl || ''}')`;

        try {
            await Tone.Transport.cancel();
            await Tone.Transport.stop();
            if (audioPlayers) audioPlayers.dispose();

            const notes = songData.notesByTrack[trackKey];
            if (!notes || notes.length === 0) throw new Error(`Track "${trackKey}" has no notes.`);
            
            totalNotes = notes.length;
            
            gameElements.albumArt.src = songData.albumArtUrl || 'https://placehold.co/300x300/111/fff?text=No+Art';
            gameElements.songTitle.textContent = songData.name;
            gameElements.songArtist.textContent = songData.artist;

            audioPlayers = new Tone.Players(songData.audioUrls).toDestination();
            await Tone.loaded();

            gameElements.loadingText.textContent = 'Ready!';
            resetGameState(notes);
            
            setTimeout(() => {
                navigateTo('game');
                gameState = 'playing';
                Tone.Transport.start(Tone.now(), 0);
                gameLoopId = requestAnimationFrame(gameLoop);
                Object.values(audioPlayers.players).forEach(p => p.start(Tone.now()));
            }, 500);

        } catch (error) {
            console.error("Failed to start game:", error);
            navigateTo('songSelect'); // Go back if it fails
        }
    }
    
    function resetGameState(notes) {
        score = 0; combo = 0; maxCombo = 0; notesHit = 0; multiplier = 1; rockMeter = 50; starPower = 0;
        isStarPowerActive = false;
        heldFrets.fill(false);
        activeSustain.fill(null);
        
        gameElements.highway.classList.remove('star-power-active');
        gameElements.noteContainer.innerHTML = '';
        
        // Create a fresh, independent copy of notes for this playthrough
        window.activeTrack = notes.map(n => ({...n, spawned: false, hit: false, missed: false, element: null}));

        updateUI();
    }

    function gameLoop() {
        if (gameState !== 'playing') return;
        gameLoopId = requestAnimationFrame(gameLoop);

        const currentTime = Tone.Transport.seconds;
        
        for (const note of window.activeTrack) {
            if (!note.spawned && note.time - currentTime < NOTE_FALL_DURATION_S) spawnNote(note);
            if (!note.hit && !note.missed) {
                 if (note.time - currentTime < -HIT_WINDOW_S) missNote(note);
                 else if (note.spawned) updateNotePosition(note, currentTime);
            }
        }
        
        for (let i = 0; i < 5; i++) {
            if (activeSustain[i]) {
                const sustainNote = activeSustain[i];
                if (currentTime >= (sustainNote.time + sustainNote.duration) || !heldFrets[i]) {
                    activeSustain[i] = null;
                } else {
                    score += 1 * (isStarPowerActive ? 2 : 1);
                }
            }
        }
        updateUI();
    }
    
    function spawnNote(note) {
        note.spawned = true;
        const noteEl = document.createElement('div');
        noteEl.className = `note ${FRET_COLORS[note.fret]}`;
        if (note.isStar) noteEl.classList.add('star-power');
        noteEl.style.left = `${note.fret * 20}%`;
        
        const gem = document.createElement('div');
        gem.className = 'note-gem';
        noteEl.appendChild(gem);
        
        if (note.duration > 0.15) { // Sustain threshold
            const trail = document.createElement('div');
            trail.className = 'sustain-trail';
            trail.style.height = `${(note.duration / NOTE_FALL_DURATION_S) * 100}vh`;
            noteEl.appendChild(trail);
        }

        note.element = noteEl;
        gameElements.noteContainer.appendChild(noteEl);
    }
    
    function updateNotePosition(note, currentTime) {
        const progress = 1 - ((note.time - currentTime) / NOTE_FALL_DURATION_S);
        note.element.style.transform = `translateY(${progress * 100}vh)`;
    }

    function handleFretPress(fretIndex) {
        heldFrets[fretIndex] = true;
        gameElements.frets[fretIndex].classList.add('active');
        if (gameState !== 'playing') return;
        
        const currentTime = Tone.Transport.seconds;
        const noteToHit = window.activeTrack.find(note =>
            !note.hit && !note.missed && note.fret === fretIndex && Math.abs(note.time - currentTime) <= HIT_WINDOW_S
        );

        if (noteToHit) hitNote(noteToHit);
    }

    function handleFretRelease(fretIndex) {
        heldFrets[fretIndex] = false;
        gameElements.frets[fretIndex].classList.remove('active');
    }

    function hitNote(note) {
        note.hit = true;
        note.element.classList.add('hidden');
        showFeedback("Perfect!");

        combo++;
        if (combo > maxCombo) maxCombo = combo;
        notesHit++;
        
        const multIndex = Math.min(Math.floor(combo / NOTES_PER_MULTIPLIER), MULTIPLIER_STAGES.length - 1);
        multiplier = MULTIPLIER_STAGES[multIndex];
        
        score += 50 * (isStarPowerActive ? multiplier * 2 : multiplier);
        rockMeter = Math.min(100, rockMeter + 2);
        if (note.isStar) starPower = Math.min(100, starPower + 5);
        
        if (note.duration > 0.15) activeSustain[note.fret] = note;
    }

    function missNote(note) {
        note.missed = true;
        note.element.classList.add('hidden');
        showFeedback("Miss");
        combo = 0;
        multiplier = 1;
        rockMeter = Math.max(0, rockMeter - 8);
        if (rockMeter <= 0) quitGame(true);
    }
    
    function showFeedback(text) {
        const feedbackEl = document.createElement('div');
        feedbackEl.className = 'feedback-text';
        feedbackEl.textContent = text;
        feedbackEl.style.color = text.toLowerCase().includes('miss') ? 'var(--fret-red)' : 'var(--accent-blue)';
        gameElements.feedbackContainer.appendChild(feedbackEl);
        setTimeout(() => feedbackEl.remove(), 500);
    }
    
    function activateStarPower() {
        if (starPower < 50 || isStarPowerActive || gameState !== 'playing') return;
        isStarPowerActive = true;
        gameElements.highway.classList.add('star-power-active');
        const spDuration = 8000;
        const drainAmount = 100 / (spDuration / 100);
        const drainInterval = setInterval(() => {
            starPower -= drainAmount;
            if (starPower <= 0) {
                starPower = 0;
                isStarPowerActive = false;
                gameElements.highway.classList.remove('star-power-active');
                clearInterval(drainInterval);
            }
        }, 100);
    }

    function updateUI() {
        gameElements.score.textContent = score;
        gameElements.combo.textContent = combo;
        gameElements.multiplier.textContent = `${isStarPowerActive ? multiplier * 2 : multiplier}x`;
        gameElements.rockMeterFill.style.width = `${rockMeter}%`;
        if (rockMeter < 25) gameElements.rockMeterFill.style.backgroundColor = 'var(--fret-red)';
        else if (rockMeter < 50) gameElements.rockMeterFill.style.backgroundColor = 'var(--fret-yellow)';
        else gameElements.rockMeterFill.style.backgroundColor = 'var(--fret-green)';
        gameElements.starPowerFill.style.width = `${starPower}%`;
    }

    function pauseGame() {
        if (gameState !== 'playing') return;
        Tone.Transport.pause();
        cancelAnimationFrame(gameLoopId);
        gameLoopId = null;
        gameState = 'paused';
        screens.pause.classList.add('active');
    }
    
    function resumeGame() {
        if (gameState !== 'paused') return;
        screens.pause.classList.remove('active');
        gameState = 'playing';
        Tone.Transport.start();
        gameLoopId = requestAnimationFrame(gameLoop);
    }
    
    function quitGame(failed = false) {
        cancelAnimationFrame(gameLoopId);
        gameLoopId = null;
        if (audioPlayers) {
            Object.values(audioPlayers.players).forEach(p => p.stop());
            audioPlayers.dispose();
            audioPlayers = null;
        }
        Tone.Transport.stop();
        if (!failed && totalNotes > 0) showResults();
        else navigateTo('mainMenu');
    }

    function showResults() {
        gameElements.resultsSongInfo.textContent = `${songData.artist} - ${songData.name}`;
        gameElements.resultsScore.textContent = score;
        gameElements.resultsNotesHit.textContent = notesHit;
        gameElements.resultsTotalNotes.textContent = totalNotes;
        const accuracy = totalNotes > 0 ? ((notesHit / totalNotes) * 100).toFixed(2) : "0.00";
        gameElements.resultsAccuracy.textContent = `${accuracy}%`;
        gameElements.resultsMaxCombo.textContent = maxCombo;
        navigateTo('results');
    }
    
    function setupInputListeners() {
        window.addEventListener('keydown', e => {
            if (e.repeat) return;
            const key = e.key.toLowerCase();
            if (KEY_MAPPING[key] === 'sp') activateStarPower();
            else if (KEY_MAPPING[key] !== undefined) handleFretPress(KEY_MAPPING[key]);
            
            if (e.key === "Escape") {
                if (gameState === 'playing') pauseGame();
                else if (gameState === 'paused') resumeGame();
            }
        });

        window.addEventListener('keyup', e => {
            const key = e.key.toLowerCase();
            if (KEY_MAPPING[key] !== undefined && KEY_MAPPING[key] !== 'sp') handleFretRelease(KEY_MAPPING[key]);
        });

        gameElements.frets.forEach((fret, index) => {
            fret.addEventListener('touchstart', e => { e.preventDefault(); handleFretPress(index); }, { passive: false });
            fret.addEventListener('touchend', e => { e.preventDefault(); handleFretRelease(index); });
            fret.addEventListener('touchcancel', e => { e.preventDefault(); handleFretRelease(index); });
        });
    }

    initialize();
});
