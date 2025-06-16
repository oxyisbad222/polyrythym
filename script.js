('DOMContentLoaded', () => {
    // --- Caching DOM Elements for performance ---
    const getElement = (id) => document.getElementById(id);
    const screens = {
        splash: getElement('splash-screen'),
        mainMenu: getElement('main-menu'),
        songSelect: getElement('song-select-screen'),
        difficultySelect: getElement('difficulty-select-screen'),
        game: getElement('game-container'),
        loading: getElement('loading-screen'),
        pause: getElement('pause-menu'),
        results: getElement('results-screen'),
    };
    const buttons = {
        playGame: getElement('play-game-btn'),
        playSetlist: getElement('play-setlist-btn'),
        backToMenu: getElement('back-to-menu-btn'),
        backToSongSelect: getElement('back-to-song-select-btn'),
        difficultyOptions: getElement('difficulty-options'),
        resume: getElement('resume-btn'),
        quit: getElement('quit-btn'),
        resultsBack: getElement('results-back-btn'),
    };
    const gameElements = {
        songCount: getElement('song-count'),
        songList: getElement('song-list'),
        difficultySongTitle: getElement('difficulty-song-title'),
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

    // --- Game State & Configuration ---
    let songs = [];
    let currentSongData = null;
    let activeTrack = { notes: [], totalNotes: 0 };
    let gameState = 'splash'; // splash, mainMenu, loading, playing, paused, results
    let audioPlayers = null;
    let gameLoopId = null;

    // --- Gameplay Variables ---
    let score, combo, maxCombo, notesHit, multiplier, rockMeter, starPower;
    let isStarPowerActive = false;
    let heldFrets = [false, false, false, false, false];
    let activeSustain = [null, null, null, null, null];

    const SETLIST_URL = 'setlist.json';
    const NOTE_FALL_DURATION_S = 1.5; // Time in seconds for a note to fall
    const HIT_WINDOW_S = 0.085; // 85ms timing window
    const KEY_MAPPING = { 'a': 0, 's': 1, 'd': 2, 'k': 3, 'l': 4, ' ': 'sp' };
    const FRET_COLORS = ['green', 'red', 'yellow', 'blue', 'orange'];
    const MULTIPLIER_STAGES = [1, 2, 3, 4];
    const NOTES_PER_MULTIPLIER = 10;
    
    // --- Core Game Flow & Screen Navigation ---
    function navigateTo(screenName) {
        Object.values(screens).forEach(s => s.classList.remove('active'));
        screens[screenName]?.classList.add('active');
        gameState = screenName;
    }

    async function initialize() {
        screens.splash.addEventListener('click', async () => {
            await Tone.start();
            console.log("AudioContext started");
            navigateTo('mainMenu');
        }, { once: true });
        
        buttons.playGame.addEventListener('click', () => songs.length > 0 && navigateTo('songSelect'));
        buttons.playSetlist.addEventListener('click', loadSetlist);
        buttons.backToMenu.addEventListener('click', () => navigateTo('mainMenu'));
        buttons.backToSongSelect.addEventListener('click', () => navigateTo('songSelect'));
        buttons.quit.addEventListener('click', quitGame);
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
            
            const songPromises = setlist.map(parseRemoteSong);
            const loadedSongs = (await Promise.all(songPromises)).filter(Boolean); // Filter out nulls from failed parses
            
            songs = [...loadedSongs]; // Replace local songs with the setlist
            if (songs.length > 0) {
                 buttons.playGame.disabled = false;
                 gameElements.songCount.textContent = `${songs.length} song${songs.length > 1 ? 's' : ''} loaded`;
                 renderSongList();
                 navigateTo('songSelect');
            } else {
                throw new Error("No songs could be loaded from the setlist.");
            }
        } catch (error) {
            console.error("Could not load setlist:", error);
            gameElements.songCount.textContent = 'Error loading setlist.';
            navigateTo('mainMenu'); // Go back to menu on error
        }
    }

    async function parseRemoteSong(songData) {
        try {
            console.log(`Parsing: ${songData.name}`);
            const chartResponse = await fetch(songData.chartUrl);
            if (!chartResponse.ok) throw new Error(`Failed to fetch chart: ${songData.chartUrl}`);
            const chartText = await chartResponse.text();
            
            const parsedChart = parseChart(chartText);
            return {
                ...songData,
                ...parsedChart
            };
        } catch (error) {
            console.error(`Failed to parse remote song "${songData.name}":`, error);
            return null;
        }
    }

    function parseChart(chartText) {
        const notesByTrack = {};
        const availableParts = {};
        const lines = chartText.split(/\r?\n/);
        
        let currentSection = '';
        let resolution = 192;
        const syncTrack = [];

        const partMapping = {
            '[ExpertSingle]': 'Guitar - Expert', '[HardSingle]': 'Guitar - Hard',
            '[ExpertBass]': 'Bass - Expert', '[HardBass]': 'Bass - Hard',
        };

        // First pass: get sync track and resolution
        lines.forEach(line => {
            line = line.trim();
            if (line.startsWith('[') && line.endsWith(']')) currentSection = line;
            if (line.includes('=')) {
                const [key, val] = line.split('=').map(s => s.trim());
                if (currentSection === '[Song]' && key === 'Resolution') resolution = parseFloat(val);
                if (currentSection === '[SyncTrack]') {
                    const [tick, type, value] = key.split(' ').filter(Boolean);
                    if (type === 'B') syncTrack.push({ tick: parseInt(tick), bpm: parseInt(value) / 1000 });
                }
            }
        });

        syncTrack.sort((a,b) => a.tick - b.tick);
        let time = 0;
        let lastTick = 0;
        let lastBpm = 120;
        if(syncTrack.length > 0) lastBpm = syncTrack[0].bpm;

        const timeMap = [{ tick: 0, time: 0, bpm: lastBpm }];
        syncTrack.forEach(event => {
            const deltaTicks = event.tick - lastTick;
            time += (deltaTicks / resolution) * (60 / lastBpm);
            timeMap.push({ tick: event.tick, time: time, bpm: event.bpm });
            lastTick = event.tick;
            lastBpm = event.bpm;
        });

        const ticksToSeconds = (ticks) => {
            const lastEvent = timeMap.filter(e => e.tick <= ticks).pop();
            const deltaTicks = ticks - lastEvent.tick;
            return lastEvent.time + (deltaTicks / resolution) * (60 / lastEvent.bpm);
        };

        // Second pass: get notes
        lines.forEach(line => {
            line = line.trim();
            if (line.startsWith('[') && line.endsWith(']')) {
                currentSection = line;
                if(partMapping[currentSection] && !notesByTrack[currentSection]) {
                    notesByTrack[currentSection] = [];
                }
            }
            if (notesByTrack[currentSection] && line.includes('=')) {
                const [key, val] = line.split('=').map(s => s.trim());
                const [tick, type, fret, ...rest] = key.split(' ').filter(Boolean);
                
                if (type === 'N') { // Note
                    notesByTrack[currentSection].push({
                        tick: parseInt(tick),
                        fret: parseInt(fret),
                        durationTicks: parseInt(val),
                        time: ticksToSeconds(parseInt(tick)),
                        duration: ticksToSeconds(parseInt(tick) + parseInt(val)) - ticksToSeconds(parseInt(tick)),
                        isStar: false,
                    });
                } else if (type === 'S' && fret === '2') { // Star Power Phrase
                     notesByTrack[currentSection].push({
                        type: 'star',
                        tick: parseInt(tick),
                        durationTicks: parseInt(val),
                    });
                }
            }
        });

        // Final processing: map sections, assign star power, create parts
        Object.keys(partMapping).forEach(section => {
            if(notesByTrack[section]?.length > 0) {
                const trackName = partMapping[section];
                const starPhrases = notesByTrack[section].filter(n => n.type === 'star');
                const finalNotes = notesByTrack[section].filter(n => n.type !== 'star');

                finalNotes.forEach(note => {
                    note.isStar = starPhrases.some(sp => note.tick >= sp.tick && note.tick < (sp.tick + sp.durationTicks));
                });
                
                notesByTrack[trackName] = finalNotes.sort((a,b) => a.time - b.time);
                delete notesByTrack[section];
                const [instrument, difficulty] = trackName.split(' - ');
                if(!availableParts[instrument]) availableParts[instrument] = [];
                availableParts[instrument].push(difficulty);
            }
        });
        
        return { notesByTrack, availableParts };
    }

    // --- UI Rendering ---
    function renderSongList() {
        gameElements.songList.innerHTML = '';
        songs.sort((a, b) => a.name.localeCompare(b.name)).forEach((song, index) => {
            const item = document.createElement('div');
            item.className = 'song-item';
            item.innerHTML = `<b>${song.name}</b><br><small>${song.artist || 'Unknown Artist'}</small>`;
            item.onclick = () => {
                currentSongData = song;
                gameElements.difficultySongTitle.textContent = `${song.artist} - ${song.name}`;
                renderDifficultyOptions(song.availableParts);
                navigateTo('difficultySelect');
            };
            gameElements.songList.appendChild(item);
        });
    }

    function renderDifficultyOptions(parts) {
        buttons.difficultyOptions.innerHTML = '';
        Object.entries(parts).forEach(([instrument, difficulties]) => {
            ['Expert', 'Hard', 'Medium', 'Easy'].forEach(difficulty => {
                 if (difficulties.includes(difficulty)) {
                    const btn = document.createElement('button');
                    btn.className = 'menu-btn';
                    btn.textContent = `${instrument} - ${difficulty}`;
                    btn.onclick = () => startGame(`${instrument} - ${difficulty}`);
                    buttons.difficultyOptions.appendChild(btn);
                 }
            });
        });
    }

    // --- GAMEPLAY ---
    async function startGame(trackKey) {
        navigateTo('loading');
        gameElements.loadingText.textContent = 'Loading audio...';

        await Tone.Transport.cancel();
        await Tone.Transport.stop();
        if (audioPlayers) audioPlayers.dispose();
        
        // Deep copy notes to prevent modification of original data
        activeTrack.notes = JSON.parse(JSON.stringify(currentSongData.notesByTrack[trackKey]));
        activeTrack.totalNotes = activeTrack.notes.filter(n => n.fret <= 4).length; // Only count playable notes

        gameElements.albumArt.src = currentSongData.albumArtUrl || 'https://placehold.co/300x300/111/fff?text=No+Art';
        gameElements.songTitle.textContent = currentSongData.name;
        gameElements.songArtist.textContent = currentSongData.artist;

        audioPlayers = new Tone.Players(currentSongData.audioUrls).toDestination();
        
        // Wait for all audio files to be loaded
        await Tone.loaded();
        
        gameElements.loadingText.textContent = 'Ready!';
        resetGameState();
        
        // Short delay before starting
        setTimeout(() => {
            navigateTo('game');
            Tone.Transport.start(Tone.now(), 0); // Start transport precisely at 0
            gameLoopId = requestAnimationFrame(gameLoop);
            Object.values(audioPlayers.players).forEach(p => p.start(Tone.now()));
        }, 500);
    }
    
    function resetGameState() {
        score = 0; combo = 0; maxCombo = 0; notesHit = 0; multiplier = 1; rockMeter = 50; starPower = 0;
        isStarPowerActive = false;
        heldFrets = [false, false, false, false, false];
        activeSustain = [null, null, null, null, null];
        
        gameElements.highway.classList.remove('star-power-active');
        gameElements.noteContainer.innerHTML = ''; // Clear previous notes
        
        // Reset notes state for re-playability
        activeTrack.notes.forEach(note => {
            note.spawned = false;
            note.hit = false;
            note.missed = false;
            if (note.element) note.element.remove();
            note.element = null;
        });

        updateUI();
    }

    function gameLoop() {
        if (gameState !== 'playing') {
            cancelAnimationFrame(gameLoopId);
            return;
        }

        const currentTime = Tone.Transport.seconds;
        
        // Spawn upcoming notes
        activeTrack.notes.forEach(note => {
            if (!note.spawned && note.time - currentTime < NOTE_FALL_DURATION_S) {
                spawnNote(note);
            }
        });

        // Update positions and check for misses
        const notesOnScreen = activeTrack.notes.filter(n => n.spawned && !n.hit && !n.missed);
        for (const note of notesOnScreen) {
            const timeUntilHit = note.time - currentTime;

            if (timeUntilHit < -HIT_WINDOW_S) {
                missNote(note);
            } else {
                const progress = 1 - (timeUntilHit / NOTE_FALL_DURATION_S);
                note.element.style.transform = `translateY(${progress * 100}vh)`;
            }
        }
        
        // Update sustain trails
        for(let i = 0; i < 5; i++) {
            if(activeSustain[i]) {
                const sustainNote = activeSustain[i];
                const sustainEnd = sustainNote.time + sustainNote.duration;
                if(currentTime >= sustainEnd || !heldFrets[i]){
                    activeSustain[i] = null; // Stop sustaining
                } else {
                     // Update sustain score
                    score += 1;
                }
            }
        }


        updateUI(); // Update score, combo etc. continuously
        gameLoopId = requestAnimationFrame(gameLoop);
    }
    
    function spawnNote(note) {
        note.spawned = true;
        const noteEl = document.createElement('div');
        noteEl.className = `note ${FRET_COLORS[note.fret]}`;
        if(note.isStar) noteEl.classList.add('star-power');
        noteEl.style.left = `${note.fret * 20}%`;
        
        const gem = document.createElement('div');
        gem.className = 'note-gem';
        noteEl.appendChild(gem);
        
        // Handle sustain trails
        if (note.duration > 0.1) { // Only add trail for notes longer than a tap
            const trail = document.createElement('div');
            trail.className = 'sustain-trail';
            
            // Calculate height based on duration and fall speed
            const fallSpeed = 100 / NOTE_FALL_DURATION_S; // vh per second
            trail.style.height = `${note.duration * fallSpeed}vh`;
            noteEl.appendChild(trail);
        }

        note.element = noteEl;
        gameElements.noteContainer.appendChild(noteEl);
    }

    function handleFretPress(fretIndex) {
        heldFrets[fretIndex] = true;
        gameElements.frets[fretIndex].classList.add('active');

        if (gameState !== 'playing') return;
        
        const currentTime = Tone.Transport.seconds;
        
        // Find the earliest hittable note for this fret
        const hittableNotes = activeTrack.notes.filter(note =>
            !note.hit && !note.missed && note.fret === fretIndex && Math.abs(note.time - currentTime) <= HIT_WINDOW_S
        );

        if (hittableNotes.length > 0) {
            const noteToHit = hittableNotes.sort((a, b) => a.time - b.time)[0];
            hitNote(noteToHit);
        }
    }

    function handleFretRelease(fretIndex) {
        heldFrets[fretIndex] = false;
        gameElements.frets[fretIndex].classList.remove('active');
        if(activeSustain[fretIndex]){
             activeSustain[fretIndex] = null;
        }
    }

    function hitNote(note) {
        note.hit = true;
        note.element.classList.add('hidden'); // Hide the note instead of removing
        
        showFeedback("Perfect!");

        combo++;
        if (combo > maxCombo) maxCombo = combo;
        notesHit++;
        
        const multIndex = Math.min(Math.floor(combo / NOTES_PER_MULTIPLIER), MULTIPLIER_STAGES.length - 1);
        multiplier = MULTIPLIER_STAGES[multIndex];
        
        score += 50 * (isStarPowerActive ? multiplier * 2 : multiplier);
        rockMeter = Math.min(100, rockMeter + 2);
        if (note.isStar) starPower = Math.min(100, starPower + 5);
        
        // Start sustaining if it's a long note
        if (note.duration > 0.1) {
            activeSustain[note.fret] = note;
        }
    }

    function missNote(note) {
        note.missed = true;
        note.element.classList.add('hidden');
        showFeedback("Miss");

        combo = 0;
        multiplier = 1;
        rockMeter = Math.max(0, rockMeter - 8);
        
        if (rockMeter <= 0) {
            quitGame(true); // Failed the song
        }
    }
    
    function showFeedback(text) {
        const feedbackEl = document.createElement('div');
        feedbackEl.className = 'feedback-text';
        feedbackEl.textContent = text;
        
        // Set color based on text
        if(text.toLowerCase().includes('miss')) {
            feedbackEl.style.color = 'var(--fret-red)';
        } else {
             feedbackEl.style.color = 'var(--accent-blue)';
        }

        gameElements.feedbackContainer.appendChild(feedbackEl);
        setTimeout(() => feedbackEl.remove(), 500);
    }
    
    function activateStarPower() {
        if (starPower < 50 || isStarPowerActive || gameState !== 'playing') return;
        isStarPowerActive = true;
        gameElements.highway.classList.add('star-power-active');
        
        const spDuration = 8000; // 8 seconds
        const drainPerInterval = (100 / spDuration) * 100;
        
        const drainInterval = setInterval(() => {
            starPower -= drainPerInterval / 100;
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
        // Change rock meter color based on value
        if (rockMeter < 25) gameElements.rockMeterFill.style.backgroundColor = 'var(--fret-red)';
        else if (rockMeter < 50) gameElements.rockMeterFill.style.backgroundColor = 'var(--fret-yellow)';
        else gameElements.rockMeterFill.style.backgroundColor = 'var(--fret-green)';
        
        gameElements.starPowerFill.style.width = `${starPower}%`;
    }

    // --- Game State Control ---
    function pauseGame() {
        if (gameState !== 'playing') return;
        Tone.Transport.pause();
        cancelAnimationFrame(gameLoopId);
        gameState = 'paused';
        screens.pause.classList.add('active');
    }
    
    function resumeGame(){
        if(gameState !== 'paused') return;
        screens.pause.classList.remove('active');
        gameState = 'playing';
        Tone.Transport.start();
        gameLoopId = requestAnimationFrame(gameLoop);
    }
    
    function quitGame(failed = false) {
        cancelAnimationFrame(gameLoopId);
        gameLoopId = null;
        gameState = 'menu';
        Tone.Transport.stop();
        if (audioPlayers) {
            Object.values(audioPlayers.players).forEach(p => p.stop());
            audioPlayers.dispose();
            audioPlayers = null;
        }

        if (!failed && activeTrack.totalNotes > 0) {
            showResults();
        } else {
            navigateTo('mainMenu');
        }
    }

    function showResults() {
        gameElements.resultsSongInfo.textContent = `${currentSongData.artist} - ${currentSongData.name}`;
        gameElements.resultsScore.textContent = score;
        gameElements.resultsNotesHit.textContent = notesHit;
        gameElements.resultsTotalNotes.textContent = activeTrack.totalNotes;
        const accuracy = activeTrack.totalNotes > 0 ? ((notesHit / activeTrack.totalNotes) * 100).toFixed(2) : "0.00";
        gameElements.resultsAccuracy.textContent = `${accuracy}%`;
        gameElements.resultsMaxCombo.textContent = maxCombo;
        navigateTo('results');
    }
    
    // --- Input Handling ---
    function setupInputListeners() {
        window.addEventListener('keydown', (e) => {
            if (e.repeat) return;
            const key = e.key.toLowerCase();
            if (KEY_MAPPING[key] !== undefined) {
                if(KEY_MAPPING[key] === 'sp') activateStarPower();
                else handleFretPress(KEY_MAPPING[key]);
            }
            if (e.key === "Escape") {
                 if(gameState === 'playing') pauseGame();
                 else if (gameState === 'paused') resumeGame();
            }
        });

        window.addEventListener('keyup', (e) => {
            const key = e.key.toLowerCase();
            if (KEY_MAPPING[key] !== undefined && KEY_MAPPING[key] !== 'sp') {
                handleFretRelease(KEY_MAPPING[key]);
            }
        });

        gameElements.frets.forEach((fret, index) => {
            fret.addEventListener('touchstart', (e) => { e.preventDefault(); handleFretPress(index); }, { passive: false });
            fret.addEventListener('touchend', (e) => { e.preventDefault(); handleFretRelease(index); });
            fret.addEventListener('touchcancel', (e) => { e.preventDefault(); handleFretRelease(index); });
        });
    }

    initialize();
});
