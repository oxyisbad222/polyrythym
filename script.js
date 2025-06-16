document.addEventListener('DOMContentLoaded', () => {
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
    const gameElements = {
        background: getElement('game-background'),
        highwayTexture: getElement('highway-texture'),
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
        songFolderInput: getElement('song-folder-input'),
        backToMenu: getElement('back-to-menu-btn'),
        backToSongSelect: getElement('back-to-song-select-btn'),
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
    let activeSustain = [null, null, null, null, null];

    const SETLIST_URL = 'setlist.json';
    const NOTE_FALL_DURATION_S = 1.5;
    const HIT_WINDOW_S = 0.085;
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
            console.log("AudioContext started.");
            navigateTo('mainMenu');
        }, { once: true });
        
        buttons.playSetlist.addEventListener('click', loadSetlist);
        buttons.songFolderInput.addEventListener('change', handleSongFolderSelect);
        buttons.backToMenu.addEventListener('click', () => navigateTo('mainMenu'));
        buttons.backToSongSelect.addEventListener('click', () => navigateTo('songSelect'));
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
            
            const songPromises = setlist.map(parseRemoteSong);
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

    async function parseRemoteSong(songData) {
        try {
            console.log(`Parsing remote song: ${songData.name}`);
            const [chartText, iniText] = await Promise.all([
                fetch(songData.chartUrl).then(res => { if (!res.ok) throw new Error(`Chart fetch failed: ${res.status}`); return res.text(); }),
                fetch(songData.iniUrl).then(res => res.ok ? res.text() : '')
            ]);

            const chartData = parseChart(chartText);
            const iniData = parseIni(iniText);

            return { ...songData, ...iniData, ...chartData };
        } catch (error) {
            console.error(`Failed to parse remote song "${songData.name}":`, error);
            return null;
        }
    }

    async function handleSongFolderSelect(event) {
        navigateTo('loading');
        gameElements.loadingText.textContent = 'Parsing local song files...';
        const files = Array.from(event.target.files);
        const folders = {};
        files.forEach(file => {
            const folderName = file.webkitRelativePath.split('/')[0];
            if (!folders[folderName]) folders[folderName] = [];
            folders[folderName].push(file);
        });

        const parsePromises = Object.values(folders).map(parseSongFolder);
        const parsedSongs = (await Promise.all(parsePromises)).filter(Boolean);
        
        songs.push(...parsedSongs);
        gameElements.songCount.textContent = `${songs.length} song${songs.length !== 1 ? 's' : ''} loaded`;
        renderSongList();
        navigateTo(songs.length > 0 ? 'songSelect' : 'mainMenu');
    }
    
    async function parseSongFolder(files) {
        try {
            const song = { name: files[0].webkitRelativePath.split('/')[0], artist: 'Unknown', audioUrls: {}, notesByTrack: {}, availableParts: {} };
            
            const iniFile = files.find(f => f.name.toLowerCase() === 'song.ini');
            if (iniFile) Object.assign(song, parseIni(await iniFile.text()));

            const artFile = files.find(f => f.name.toLowerCase().match(/album\.(jpg|jpeg|png)$/));
            if (artFile) song.albumArtUrl = URL.createObjectURL(artFile);
            
            const bgFile = files.find(f => f.name.toLowerCase().match(/background\.(jpg|jpeg|png)$/));
            if (bgFile) song.backgroundUrl = URL.createObjectURL(bgFile);
            
            const highwayFile = files.find(f => f.name.toLowerCase().match(/highway\.(jpg|jpeg|png)$/));
            if (highwayFile) song.highwayUrl = URL.createObjectURL(highwayFile);
            
            files.filter(f => f.name.endsWith('.opus') || f.name.endsWith('.ogg') || f.name.endsWith('.mp3')).forEach(f => {
                const stemName = f.name.substring(0, f.name.lastIndexOf('.'));
                song.audioUrls[stemName] = URL.createObjectURL(f);
            });

            const chartFile = files.find(f => f.name.toLowerCase() === 'notes.chart');
            const midiFile = files.find(f => f.name.toLowerCase() === 'notes.mid');

            if (chartFile) {
                Object.assign(song, parseChart(await chartFile.text()));
            } else if (midiFile) {
                Object.assign(song, parseMidi(await midiFile.arrayBuffer()));
            } else {
                 return null;
            }
            
            if (Object.keys(song.availableParts).length === 0 || Object.keys(song.audioUrls).length === 0) {
                 return null;
            }
            return song;
        } catch (error) { console.error("Failed to parse song folder:", error); return null; }
    }


    function parseIni(text) {
        const data = {};
        if (!text) return data;
        const lines = text.split(/\r?\n/);
        let inSongSection = false;
        for (const line of lines) {
            if (line.trim().toLowerCase() === '[song]') {
                inSongSection = true;
                continue;
            }
            if (line.trim().startsWith('[')) {
                inSongSection = false;
                continue;
            }
            if (inSongSection) {
                const parts = line.split('=').map(s => s.trim());
                if (parts.length === 2) {
                    data[parts[0].toLowerCase()] = parts[1];
                }
            }
        }
        return data;
    }
    
    function parseMidi(arrayBuffer) {
        const midi = MidiParser.parse(arrayBuffer);
        const resolution = midi.timeDivision;
        const notesByTrack = {};
        const availableParts = {};

        const tempoEvents = [];
        midi.track.forEach(track => {
            let currentTick = 0;
            track.event.forEach(event => {
                currentTick += event.deltaTime;
                if (event.metaType === 81) {
                    tempoEvents.push({
                        tick: currentTick,
                        bpm: 60000000 / ((event.data[0] << 16) | (event.data[1] << 8) | event.data[2])
                    });
                }
            });
        });
        tempoEvents.sort((a,b) => a.tick - b.tick);
    
        const syncTrack = [];
        let lastBpm = 120; let lastTick = 0; let timeAtLastBpm = 0;
        if (tempoEvents.length === 0 || tempoEvents[0].tick > 0) {
            syncTrack.push({ tick: 0, bpm: 120, time: 0 });
        }
    
        tempoEvents.forEach(bpmEvent => {
            const ticksSinceLast = bpmEvent.tick - lastTick;
            timeAtLastBpm += (ticksSinceLast / resolution) * (60 / lastBpm);
            bpmEvent.time = timeAtLastBpm;
            syncTrack.push(bpmEvent);
            lastTick = bpmEvent.tick;
            lastBpm = bpmEvent.bpm;
        });
    
        const ticksToSeconds = (ticks) => {
            let time = 0; let lastTick = 0; let lastBpm = 120;
            const relevantEvent = [...syncTrack].reverse().find(e => e.tick <= ticks);
            if (relevantEvent) {
                time = relevantEvent.time;
                lastTick = relevantEvent.tick;
                lastBpm = relevantEvent.bpm;
            }
            time += ((ticks - lastTick) / resolution) * (60 / lastBpm);
            return time;
        };
        
        const trackMappings = {
            'PART GUITAR': { name: 'Guitar', difficulties: { 'Expert': 96, 'Hard': 84, 'Medium': 72, 'Easy': 60 } },
            'PART BASS': { name: 'Bass', difficulties: { 'Expert': 96, 'Hard': 84, 'Medium': 72, 'Easy': 60 } }
        };
        const STAR_POWER_NOTE = 116;

        midi.track.forEach(track => {
            const trackNameEvent = track.event.find(e => e.metaType === 3);
            const trackName = trackNameEvent ? trackNameEvent.data : '';
            const mapping = trackMappings[trackName];

            if (!mapping) return;

            let currentTick = 0;
            const notes = [];
            const activeNotes = {};

            track.event.forEach(event => {
                currentTick += event.deltaTime;
                const type = event.type;
                if (type === 9 && event.data[1] > 0) { // Note On
                    activeNotes[event.data[0]] = { tick: currentTick, note: event.data[0] };
                } else if (type === 8 || (type === 9 && event.data[1] === 0)) { // Note Off
                    const startNote = activeNotes[event.data[0]];
                    if (startNote) {
                        notes.push({ tick: startNote.tick, midiNote: startNote.note, duration: currentTick - startNote.tick });
                        delete activeNotes[event.data[0]];
                    }
                }
            });

            const starPhrases = notes.filter(n => n.midiNote === STAR_POWER_NOTE).map(n => ({ tick: n.tick, duration: n.duration }));

            Object.entries(mapping.difficulties).forEach(([diffName, baseNote]) => {
                 const difficultyNotes = notes
                    .filter(n => n.midiNote >= baseNote && n.midiNote < baseNote + 5)
                    .map(n => ({
                        time: ticksToSeconds(n.tick),
                        fret: n.midiNote - baseNote,
                        duration: ticksToSeconds(n.tick + n.duration) - ticksToSeconds(n.tick),
                        isStar: starPhrases.some(sp => n.tick >= sp.tick && n.tick < (sp.tick + sp.duration))
                    }));
                
                if (difficultyNotes.length > 0) {
                    const trackKey = `${mapping.name} - ${diffName}`;
                    notesByTrack[trackKey] = difficultyNotes.sort((a, b) => a.time - b.time);
                    if(!availableParts[mapping.name]) availableParts[mapping.name] = [];
                    availableParts[mapping.name].push(diffName);
                }
            });
        });
        
        return { notesByTrack, availableParts };
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
            '[MediumSingle]': 'Guitar - Medium', '[EasySingle]': 'Guitar - Easy',
            '[ExpertBass]': 'Bass - Expert', '[HardBass]': 'Bass - Hard',
            '[MediumBass]': 'Bass - Medium', '[EasyBass]': 'Bass - Easy'
        };

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
        let time = 0, lastTick = 0;
        let lastBpm = syncTrack[0]?.bpm || 120;
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
        
        const tempNotes = {};
        lines.forEach(line => {
            line = line.trim();
            if (line.startsWith('[') && line.endsWith(']')) currentSection = line;
            if (partMapping[currentSection] && line.includes('=')) {
                if (!tempNotes[currentSection]) tempNotes[currentSection] = [];
                const [key, val] = line.split('=').map(s => s.trim());
                const [tick, type, data1] = key.split(' ').filter(Boolean);
                if (type === 'N') tempNotes[currentSection].push({ type: 'note', tick: parseInt(tick), fret: parseInt(data1), durationTicks: parseInt(val) });
                if (type === 'S' && data1 === '2') tempNotes[currentSection].push({ type: 'star', tick: parseInt(tick), durationTicks: parseInt(val) });
            }
        });

        Object.keys(partMapping).forEach(section => {
            if(tempNotes[section]?.length > 0){
                const trackName = partMapping[section];
                const starPhrases = tempNotes[section].filter(n => n.type === 'star');
                const finalNotes = tempNotes[section]
                    .filter(n => n.type === 'note' && n.fret <= 4)
                    .map(note => ({
                        time: ticksToSeconds(note.tick),
                        fret: note.fret,
                        duration: ticksToSeconds(note.tick + note.durationTicks) - ticksToSeconds(note.tick),
                        isStar: starPhrases.some(sp => note.tick >= sp.tick && note.tick < (sp.tick + sp.durationTicks))
                    }));

                notesByTrack[trackName] = finalNotes.sort((a,b) => a.time - b.time);
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
        songs.sort((a, b) => (a.name || 'Z').localeCompare(b.name || 'Z')).forEach(song => {
            const item = document.createElement('div');
            item.className = 'song-item';
            item.innerHTML = `<b>${song.name}</b><br><small>${song.artist || 'Unknown Artist'}</small>`;
            item.onclick = () => {
                currentSongData = song;
                gameElements.difficultySongTitle.textContent = `${song.artist || song.name} - ${song.name}`;
                renderDifficultyOptions(song);
                navigateTo('difficultySelect');
            };
            gameElements.songList.appendChild(item);
        });
    }

    function renderDifficultyOptions(song) {
        buttons.difficultyOptions.innerHTML = '';
        Object.entries(song.availableParts).forEach(([instrument, difficulties]) => {
            ['Expert', 'Hard', 'Medium', 'Easy'].forEach(difficulty => {
                 if (difficulties.includes(difficulty)) {
                    const trackKey = `${instrument} - ${difficulty}`;
                    if(song.notesByTrack[trackKey] && song.notesByTrack[trackKey].length > 0) {
                        const btn = document.createElement('button');
                        btn.className = 'menu-btn';
                        btn.textContent = trackKey;
                        btn.onclick = () => startGame(song, trackKey);
                        buttons.difficultyOptions.appendChild(btn);
                    }
                 }
            });
        });
    }

    // --- GAMEPLAY ---
    async function startGame(songData, trackKey) {
        try {
            console.log(`[startGame] Attempting to start song: ${songData.name} - ${trackKey}`);
            navigateTo('loading');
            gameElements.loadingText.textContent = 'Loading Assets...';
            
            const notes = songData.notesByTrack[trackKey];
            if (!notes || notes.length === 0) {
                throw new Error(`Track key "${trackKey}" not found or is empty in song data.`);
            }

            console.log('[startGame] Setting visuals...');
            gameElements.background.style.backgroundImage = `url('${songData.backgroundUrl || ''}')`;
            gameElements.highwayTexture.style.backgroundImage = `url('${songData.highwayUrl || ''}')`;
            gameElements.albumArt.src = songData.albumArtUrl || 'https://placehold.co/300x300/111/fff?text=No+Art';
            gameElements.songTitle.textContent = songData.name || 'Unknown Song';
            gameElements.songArtist.textContent = songData.artist || 'Unknown Artist';

            console.log('[startGame] Cleaning up old audio...');
            await Tone.Transport.cancel();
            await Tone.Transport.stop();
            if (audioPlayers) audioPlayers.dispose();
            
            console.log('[startGame] Loading new audio...');
            gameElements.loadingText.textContent = 'Loading Audio...';
            audioPlayers = new Tone.Players(songData.audioUrls).toDestination();
            await Tone.loaded();
            console.log('[startGame] Audio loaded.');
            
            gameElements.loadingText.textContent = 'Ready!';
            resetGameState(notes);
            
            console.log('[startGame] Scheduling gameplay start.');
            setTimeout(() => {
                navigateTo('game');
                gameState = 'playing';
                Tone.Transport.start(Tone.now(), 0);
                gameLoopId = requestAnimationFrame(gameLoop);
                Object.values(audioPlayers.players).forEach(p => p.start(Tone.now()));
                console.log('[startGame] Gameplay started.');
            }, 500);

        } catch (error) {
            console.error("--- FATAL: Could not start game ---", error);
            // Navigate back to the song selection screen to prevent getting stuck.
            navigateTo('songSelect');
        }
    }
    
    function resetGameState(notes) {
        console.log('[resetGameState] Resetting all gameplay variables.');
        score = 0; combo = 0; maxCombo = 0; notesHit = 0; multiplier = 1; rockMeter = 50; starPower = 0;
        isStarPowerActive = false;
        heldFrets.fill(false);
        activeSustain.fill(null);
        
        gameElements.highway.classList.remove('star-power-active');
        gameElements.noteContainer.innerHTML = '';
        
        activeTrack = {
            notes: JSON.parse(JSON.stringify(notes)),
            totalNotes: notes.length
        };
        activeTrack.notes.forEach(note => {
            note.spawned = false;
            note.hit = false;
            note.missed = false;
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
        
        activeTrack.notes.forEach(note => {
            if (!note.spawned && note.time - currentTime < NOTE_FALL_DURATION_S) {
                spawnNote(note);
            } else if (note.spawned && !note.hit && !note.missed) {
                if (note.time - currentTime < -HIT_WINDOW_S) {
                    missNote(note);
                } else {
                    updateNotePosition(note, currentTime);
                }
            }
        });
        
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
        gameLoopId = requestAnimationFrame(gameLoop);
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
        
        if (note.duration > 0.15) {
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
        const noteToHit = activeTrack.notes.find(note =>
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
        if (!failed && activeTrack.totalNotes > 0) {
            showResults();
        } else {
            navigateTo('songSelect');
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
    
    function setupInputListeners() {
        window.addEventListener('keydown', (e) => {
            if (e.repeat) return;
            const key = e.key.toLowerCase();
            if (KEY_MAPPING[key] !== undefined) {
                if(KEY_MAPPING[key] === 'sp') activateStarPower();
                else handleFretPress(KEY_MAPPING[key]);
            }
            if (e.key === "Escape") {
                if (gameState === 'playing') pauseGame();
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
