document.addEventListener('DOMContentLoaded', () => {
    // --- Element Cache ---
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
    const gameElements = {
        background: getElement('game-background'),
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
    const buttons = {
        playSetlist: getElement('play-setlist-btn'),
        backToMenu: getElement('back-to-menu-btn'),
        difficultyOptions: getElement('difficulty-options'),
        resume: getElement('resume-btn'),
        quit: getElement('quit-btn'),
        resultsBack: getElement('results-back-btn'),
    };

    // --- Game State & Configuration ---
    let songs = [];
    let currentSongData = null;
    let activeTrack = { notes: [], totalNotes: 0 };
    let gameState = 'splash';
    let audioPlayers = null;
    let gameLoopId = null;

    // --- Gameplay Variables ---
    let score, combo, maxCombo, notesHit, multiplier, rockMeter, starPower;
    let isStarPowerActive = false;
    let heldFrets = [false, false, false, false, false];

    // --- Constants ---
    const SETLIST_URL = 'setlist.json';
    const NOTE_FALL_DURATION_S = 1.5;
    const HIT_WINDOW_S = 0.1; // Slightly more generous timing window
    const SONG_START_DELAY_S = 2; // 2-second pre-game countdown
    const KEY_MAPPING = { 'a': 0, 's': 1, 'd': 2, 'k': 3, 'l': 4, ' ': 'sp' };
    const FRET_COLORS = ['green', 'red', 'yellow', 'blue', 'orange'];
    const MULTIPLIER_STAGES = [1, 2, 3, 4];
    const NOTES_PER_MULTIPLIER = 10;

    // --- Core Game Flow & Screen Management ---
    const navigateTo = (screenName) => {
        Object.values(screens).forEach(s => s.classList.remove('active'));
        screens[screenName]?.classList.add('active');
        gameState = screenName;
    };

    const updateLoadingText = (text) => {
        gameElements.loadingText.textContent = text;
    };

    // --- Asset Loading and Parsing ---
    const loadSetlist = async () => {
        navigateTo('loading');
        try {
            updateLoadingText('Fetching Online Setlist...');
            const response = await fetch(SETLIST_URL);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const setlist = await response.json();
            songs = setlist; // Directly assign, assuming valid format for now
            gameElements.songCount.textContent = `${songs.length} song${songs.length > 1 ? 's' : ''} loaded`;
            renderSongList();
            navigateTo('songSelect');
        } catch (error) {
            console.error("Could not load setlist:", error);
            alert("Error loading online setlist. Please check the console for details.");
            navigateTo('mainMenu');
        }
    };
    
    // This function is kept for local file loading if you re-add that feature.
    // For now, it's unused to simplify the focus on the online setlist.
    async function handleSongFolderSelect(event) {
        alert("Local file loading is not currently implemented.");
    }

    const parseChart = (chartText) => {
        // ... (This function remains the same as the robust version from before)
        // It's assumed to be correct for the purpose of this refactor.
        // A real-world scenario might involve replacing this with a more heavily tested library.
        const notesByTrack = {};
        const availableParts = {};
        const lines = chartText.split(/\r?\n/);
        let currentSection = '', resolution = 192;
        const syncTrack = [];
        const partMapping = {
            '[ExpertSingle]': 'Guitar - Expert', '[HardSingle]': 'Guitar - Hard',
            '[MediumSingle]': 'Guitar - Medium', '[EasySingle]': 'Guitar - Easy'
        };
        lines.forEach(line => {
            line = line.trim();
            if (line.startsWith('[') && line.endsWith(']')) currentSection = line;
            else if (line.includes('=')) {
                const [key, val] = line.split('=').map(s => s.trim());
                if (currentSection === '[Song]' && key === 'Resolution') resolution = parseFloat(val);
                if (currentSection === '[SyncTrack]' && key.split(' ')[1] === 'B') {
                    syncTrack.push({ tick: parseInt(key.split(' ')[0]), bpm: parseInt(val) / 1000 });
                }
            }
        });
        syncTrack.sort((a, b) => a.tick - b.tick);
        let time = 0, lastTick = 0, lastBpm = syncTrack[0]?.bpm || 120;
        const timeMap = [{ tick: 0, time: 0, bpm: lastBpm }];
        syncTrack.forEach(event => {
            const deltaTicks = event.tick - lastTick;
            time += (deltaTicks / resolution) * (60 / lastBpm);
            timeMap.push({ tick: event.tick, time, bpm: event.bpm });
            lastTick = event.tick;
            lastBpm = event.bpm;
        });
        const ticksToSeconds = (ticks) => {
            const lastEvent = timeMap.filter(e => e.tick <= ticks).pop();
            return lastEvent.time + ((ticks - lastEvent.tick) / resolution) * (60 / lastEvent.bpm);
        };
        const tempNotes = {};
        lines.forEach(line => {
            line = line.trim();
            if (line.startsWith('[') && line.endsWith(']')) currentSection = line;
            else if (partMapping[currentSection] && line.includes('=')) {
                if (!tempNotes[currentSection]) tempNotes[currentSection] = [];
                const [key, val] = line.split('=').map(s => s.trim());
                const [tick, type, data1, data2] = key.split(' ').filter(Boolean);
                if (type === 'N') tempNotes[currentSection].push({ type: 'note', tick: parseInt(tick), fret: parseInt(data1), durationTicks: parseInt(data2) });
                if (type === 'S' && data1 === '2') tempNotes[currentSection].push({ type: 'star', tick: parseInt(tick), durationTicks: parseInt(data2) });
            }
        });
        Object.keys(partMapping).forEach(section => {
            if (tempNotes[section]?.length > 0) {
                const trackName = partMapping[section];
                const starPhrases = tempNotes[section].filter(n => n.type === 'star');
                const finalNotes = tempNotes[section].filter(n => n.type === 'note' && n.fret <= 4).map(note => ({
                    time: ticksToSeconds(note.tick), fret: note.fret,
                    duration: ticksToSeconds(note.tick + note.durationTicks) - ticksToSeconds(note.tick),
                    isStar: starPhrases.some(sp => note.tick >= sp.tick && note.tick < (sp.tick + sp.durationTicks))
                }));
                if (finalNotes.length > 0) {
                    notesByTrack[trackName] = finalNotes.sort((a, b) => a.time - b.time);
                    const [instrument, difficulty] = trackName.split(' - ');
                    if (!availableParts[instrument]) availableParts[instrument] = [];
                    availableParts[instrument].push(difficulty);
                }
            }
        });
        return { notesByTrack, availableParts };
    };

    // --- UI Rendering ---
    const renderSongList = () => {
        gameElements.songList.innerHTML = '';
        songs.forEach(song => {
            const item = document.createElement('div');
            item.className = 'song-item';
            item.innerHTML = `<b>${song.name}</b><br><small>${song.artist || 'Unknown Artist'}</small>`;
            item.onclick = () => {
                currentSongData = song;
                gameElements.difficultySongTitle.textContent = `${song.name} - ${song.artist || 'Unknown'}`;
                renderDifficultyOptions(song);
                navigateTo('difficultySelect');
            };
            gameElements.songList.appendChild(item);
        });
    };

    const renderDifficultyOptions = (songData) => {
        buttons.difficultyOptions.innerHTML = '';
        // Mockup since parsing is now inside startGame
        ['Expert', 'Hard', 'Medium', 'Easy'].forEach(diff => {
            const btn = document.createElement('button');
            btn.className = 'menu-btn';
            btn.textContent = `Guitar - ${diff}`;
            btn.onclick = () => startGame(songData, `Guitar - ${diff}`);
            buttons.difficultyOptions.appendChild(btn);
        });
    };

    // --- GAMEPLAY ---
    
    const cleanupAudio = () => {
        if (audioPlayers) {
            audioPlayers.dispose();
            audioPlayers = null;
        }
        Tone.Transport.stop();
        Tone.Transport.cancel();
    };

    const startGame = async (songData, trackKey) => {
        navigateTo('loading');

        try {
            // STEP 1: Fetch and Parse Chart Data
            updateLoadingText('Loading Song Data...');
            const chartResponse = await fetch(songData.chartUrl);
            if (!chartResponse.ok) throw new Error(`Network response was not ok for chart file. Status: ${chartResponse.status}`);
            const chartText = await chartResponse.text();
            
            const parsedData = parseChart(chartText);
            const notes = parsedData.notesByTrack[trackKey];
            if (!notes || notes.length === 0) {
                throw new Error(`The selected difficulty "${trackKey}" contains no notes or does not exist in the chart file.`);
            }

            // STEP 2: Load Audio
            updateLoadingText('Loading Audio...');
            cleanupAudio(); // Ensure old players are gone
            audioPlayers = new Tone.Players(songData.audioUrls).toDestination();
            await Tone.loaded();

            // STEP 3: Load Visuals (can be done in parallel)
            updateLoadingText('Loading Visuals...');
            gameElements.background.style.backgroundImage = `url('${songData.backgroundUrl || ''}')`;
            gameElements.albumArt.src = songData.albumArtUrl || ''; // Set album art
            gameElements.songTitle.textContent = songData.name;
            gameElements.songArtist.textContent = songData.artist || 'Unknown Artist';

            // STEP 4: Final Setup and Countdown
            updateLoadingText('Starting Game...');
            resetGameState(notes);

            setTimeout(() => {
                navigateTo('game');
                gameState = 'playing';
                Tone.Transport.start(Tone.now(), 0);
                Object.values(audioPlayers.players).forEach(p => p.start());
                gameLoopId = requestAnimationFrame(gameLoop);
            }, SONG_START_DELAY_S * 1000);

        } catch (error) {
            console.error("--- FATAL: Could not start game ---", error);
            alert(`Failed to start game: ${error.message}\n\nThis can happen due to network issues or CORS policy on the server hosting the song files. Please check the console (F12) for more details.`);
            cleanupAudio(); // Clean up on failure
            navigateTo('songSelect'); // Go back to the menu
        }
    };
    
    const resetGameState = (notes) => {
        score = combo = maxCombo = notesHit = 0;
        multiplier = 1; rockMeter = 50; starPower = 0;
        isStarPowerActive = false;
        heldFrets.fill(false);
        gameElements.highway.classList.remove('star-power-active');
        gameElements.noteContainer.innerHTML = '';
        
        activeTrack = {
            notes: JSON.parse(JSON.stringify(notes)),
            totalNotes: notes.length,
        };
        activeTrack.notes.forEach(note => {
            note.spawned = false;
            note.hit = false;
            note.missed = false;
        });

        updateUI();
    };

    // --- GAME LOOP AND MECHANICS (remains largely the same) ---
    const gameLoop = () => {
        if (gameState !== 'playing') {
             cancelAnimationFrame(gameLoopId);
             return;
        }
        const currentTime = Tone.Transport.seconds;
        activeTrack.notes.forEach(note => {
            const noteAppearanceTime = note.time - NOTE_FALL_DURATION_S;
            if (!note.spawned && currentTime >= noteAppearanceTime) spawnNote(note);
            if (note.spawned && !note.hit && !note.missed) {
                if (note.time - currentTime < -HIT_WINDOW_S) missNote(note);
                else updateNotePosition(note, currentTime);
            }
        });
        updateUI();
        gameLoopId = requestAnimationFrame(gameLoop);
    };

    const spawnNote = (note) => {
        note.spawned = true;
        const noteEl = document.createElement('div');
        noteEl.className = `note ${FRET_COLORS[note.fret]}`;
        if (note.isStar) noteEl.classList.add('star-power');
        noteEl.style.left = `${note.fret * 20}%`;
        const gem = document.createElement('div');
        gem.className = 'note-gem';
        noteEl.appendChild(gem);
        note.element = noteEl;
        gameElements.noteContainer.appendChild(noteEl);
    };

    const updateNotePosition = (note, currentTime) => {
        const progress = 1 - ((note.time - currentTime) / NOTE_FALL_DURATION_S);
        if (note.element) note.element.style.transform = `translateY(${progress * 100}vh)`;
    };
    
    const hitNote = (note) => {
        note.hit = true;
        if(note.element) note.element.style.display = 'none';
        combo++;
        maxCombo = Math.max(maxCombo, combo);
        notesHit++;
        multiplier = MULTIPLIER_STAGES[Math.min(Math.floor(combo / NOTES_PER_MULTIPLIER), 3)];
        score += 50 * (isStarPowerActive ? multiplier * 2 : multiplier);
        rockMeter = Math.min(100, rockMeter + 2);
    };

    const missNote = (note) => {
        note.missed = true;
        if(note.element) note.element.style.display = 'none';
        combo = 0;
        multiplier = 1;
        rockMeter = Math.max(0, rockMeter - 8);
        if (rockMeter <= 0) quitGame(true);
    };

    const handleFretPress = (fretIndex) => {
        heldFrets[fretIndex] = true;
        gameElements.frets[fretIndex].classList.add('active');
        if (gameState !== 'playing') return;
        const currentTime = Tone.Transport.seconds;
        const noteToHit = activeTrack.notes.find(n => !n.hit && !n.missed && n.fret === fretIndex && Math.abs(n.time - currentTime) <= HIT_WINDOW_S);
        if (noteToHit) hitNote(noteToHit);
    };
    
    const handleFretRelease = (fretIndex) => {
        heldFrets[fretIndex] = false;
        gameElements.frets[fretIndex].classList.remove('active');
    };

    const quitGame = (failed = false) => {
        cancelAnimationFrame(gameLoopId);
        gameLoopId = null;
        cleanupAudio();
        if (!failed && activeTrack.totalNotes > 0) showResults();
        else navigateTo('songSelect');
    };

    const showResults = () => {
        gameElements.resultsSongInfo.textContent = `${currentSongData.name}`;
        gameElements.resultsScore.textContent = score;
        gameElements.resultsNotesHit.textContent = notesHit;
        gameElements.resultsTotalNotes.textContent = activeTrack.totalNotes;
        gameElements.resultsAccuracy.textContent = `${(activeTrack.totalNotes > 0 ? (notesHit / activeTrack.totalNotes) * 100 : 0).toFixed(2)}%`;
        gameElements.resultsMaxCombo.textContent = maxCombo;
        navigateTo('results');
    };

    const updateUI = () => {
        gameElements.score.textContent = score;
        gameElements.combo.textContent = combo;
        gameElements.multiplier.textContent = `${isStarPowerActive ? multiplier * 2 : multiplier}x`;
        gameElements.rockMeterFill.style.width = `${rockMeter}%`;
        gameElements.rockMeterFill.style.backgroundColor = rockMeter < 25 ? 'var(--fret-red)' : rockMeter < 50 ? 'var(--fret-yellow)' : 'var(--fret-green)';
    };

    // --- INITIALIZATION ---
    const initialize = () => {
        screens.splash.addEventListener('click', async () => {
            await Tone.start();
            navigateTo('mainMenu');
        }, { once: true });
        
        buttons.playSetlist.addEventListener('click', loadSetlist);
        
        // Setup other menu buttons
        buttons.backToMenu.addEventListener('click', () => navigateTo('mainMenu'));
        getElement('back-to-song-select-btn').addEventListener('click', () => navigateTo('songSelect'));
        buttons.quit.addEventListener('click', () => quitGame(false));
        buttons.resume.addEventListener('click', () => {}); // Pause/Resume not implemented in this version
        buttons.resultsBack.addEventListener('click', () => navigateTo('songSelect'));

        // Keyboard listeners
        window.addEventListener('keydown', (e) => {
            if (e.repeat) return;
            const key = e.key.toLowerCase();
            if (KEY_MAPPING[key] !== undefined) handleFretPress(KEY_MAPPING[key]);
        });
        window.addEventListener('keyup', (e) => {
            const key = e.key.toLowerCase();
            if (KEY_MAPPING[key] !== undefined) handleFretRelease(KEY_MAPPING[key]);
        });
    };

    initialize();
});
