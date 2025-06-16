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
    const HIT_WINDOW_S = 0.1;
    const KEY_MAPPING = { 'a': 0, 's': 1, 'd': 2, 'k': 3, 'l': 4, ' ': 'sp' };
    const FRET_COLORS = ['green', 'red', 'yellow', 'blue', 'orange', 'purple', 'cyan', 'white'];

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
            songs = await response.json();
            gameElements.songCount.textContent = `${songs.length} song${songs.length > 1 ? 's' : ''} loaded`;
            renderSongList();
            navigateTo('songSelect');
        } catch (error) {
            console.error("Could not load setlist:", error);
            alert("Error loading online setlist.");
            navigateTo('mainMenu');
        }
    };
    
    const parseChart = (chartText) => {
        const songData = {
            metadata: {},
            syncTrack: [],
            events: [],
            notesByTrack: {},
            availableParts: {}
        };
        const lines = chartText.split(/\r?\n/);
        let currentSection = '';
        let inBrackets = false;

        lines.forEach(line => {
            line = line.trim();
            if (line.startsWith('[') && line.endsWith(']')) {
                currentSection = line;
                return;
            }
            if (line === '{') {
                inBrackets = true;
                return;
            }
            if (line === '}') {
                inBrackets = false;
                return;
            }

            if (inBrackets) {
                const parts = line.split('=').map(s => s.trim());
                if (parts.length < 2) return;
                const key = parts[0];
                const value = parts.slice(1).join('=').replace(/"/g, '');

                switch (currentSection) {
                    case '[Song]':
                        songData.metadata[key] = isNaN(value) ? value : parseFloat(value);
                        break;
                    case '[SyncTrack]':
                        songData.syncTrack.push({ tick: parseInt(key), rawValue: value });
                        break;
                    case '[Events]':
                        songData.events.push({ tick: parseInt(key), text: value });
                        break;
                    default: // Instrument Tracks
                        if (!songData.notesByTrack[currentSection]) {
                            songData.notesByTrack[currentSection] = [];
                        }
                        songData.notesByTrack[currentSection].push({ tick: parseInt(key), rawValue: value });
                        break;
                }
            }
        });

        // --- Process Raw Parsed Data ---
        const { metadata, syncTrack, notesByTrack } = songData;
        const resolution = metadata.Resolution || 192;
        
        const bpmEvents = syncTrack.filter(e => e.rawValue.includes('B')).map(e => ({
            tick: e.tick,
            bpm: parseInt(e.rawValue.split(' ')[1]) / 1000
        }));
        bpmEvents.sort((a, b) => a.tick - b.tick);

        let time = 0, lastTick = 0;
        let lastBpm = bpmEvents[0]?.bpm || 120;
        const timeMap = [{ tick: 0, time: 0, bpm: lastBpm }];
        bpmEvents.forEach(event => {
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

        for (const trackName in notesByTrack) {
            const rawNotes = notesByTrack[trackName];
            const starPhrases = rawNotes.filter(n => n.rawValue.startsWith('S 2')).map(n => ({
                tick: n.tick,
                durationTicks: parseInt(n.rawValue.split(' ')[2])
            }));

            const finalNotes = rawNotes.filter(n => n.rawValue.startsWith('N')).map(n => {
                const parts = n.rawValue.split(' ');
                const fret = parseInt(parts[1]);
                const durationTicks = parseInt(parts[2]);
                return {
                    time: ticksToSeconds(n.tick),
                    fret,
                    duration: ticksToSeconds(n.tick + durationTicks) - ticksToSeconds(n.tick),
                    isStar: starPhrases.some(sp => n.tick >= sp.tick && n.tick < (sp.tick + sp.durationTicks))
                };
            });
            
            if (finalNotes.length > 0) {
                const cleanTrackName = trackName.substring(1, trackName.length - 1);
                songData.notesByTrack[cleanTrackName] = finalNotes.sort((a,b) => a.time - b.time);
                
                if (!songData.availableParts[cleanTrackName]) {
                    songData.availableParts[cleanTrackName] = finalNotes.length;
                }
            }
            delete songData.notesByTrack[trackName];
        }
        
        return songData;
    };


    // --- UI Rendering ---
    const renderSongList = () => {
        gameElements.songList.innerHTML = '';
        songs.forEach(song => {
            const item = document.createElement('div');
            item.className = 'song-item';
            item.innerHTML = `<b>${song.name}</b>`;
            item.onclick = () => {
                currentSongData = song;
                navigateTo('difficultySelect');
                gameElements.difficultySongTitle.textContent = "Loading difficulties...";
                renderDifficultyOptions(song);
            };
            gameElements.songList.appendChild(item);
        });
    };

    const renderDifficultyOptions = async (songData) => {
        buttons.difficultyOptions.innerHTML = '';
        try {
            const chartResponse = await fetch(songData.chartUrl);
            if (!chartResponse.ok) throw new Error('Could not fetch chart to list difficulties.');
            const chartText = await chartResponse.text();
            const parsedData = parseChart(chartText);

            gameElements.difficultySongTitle.textContent = `${parsedData.metadata.Artist} - ${parsedData.metadata.Name}`;

            if (Object.keys(parsedData.availableParts).length === 0) {
                 buttons.difficultyOptions.innerHTML = '<li>No playable tracks found in chart file.</li>';
                 return;
            }

            for (const partName in parsedData.availableParts) {
                 const btn = document.createElement('button');
                 btn.className = 'menu-btn';
                 btn.textContent = partName;
                 btn.onclick = () => startGame(songData, parsedData, partName);
                 buttons.difficultyOptions.appendChild(btn);
            }
        } catch (error) {
            console.error("Error rendering difficulties:", error);
            alert("Could not load difficulty options for this song.");
            navigateTo('songSelect');
        }
    };

    const cleanupAudio = () => {
        if (audioPlayers) {
            audioPlayers.dispose();
            audioPlayers = null;
        }
        Tone.Transport.stop();
        Tone.Transport.cancel();
    };

    // --- GAMEPLAY ---
    const startGame = async (songInfo, parsedChart, trackKey) => {
        navigateTo('loading');
        try {
            updateLoadingText('Loading Audio...');
            cleanupAudio();
            
            // *** NEW: Audio Fallback Logic ***
            // Prioritize mp3, then ogg, then a default name.
            const audioUrl = songInfo.audioUrls.song_mp3 || songInfo.audioUrls.song_ogg || songInfo.audioUrls.song;
            if (!audioUrl) {
                throw new Error("No audio URL could be found for this song in setlist.json.");
            }
            
            audioPlayers = new Tone.Players({ "song": audioUrl }).toDestination();
            await Tone.loaded();

            if (!audioPlayers || !audioPlayers.has("song") || !audioPlayers.get("song").loaded) {
                throw new Error("Audio file failed to load or decode. The browser may not support the format, or the file could be corrupt.");
            }

            updateLoadingText('Setting up visuals...');
            const notes = parsedChart.notesByTrack[trackKey];
            if (!notes || !notes.length === 0) throw new Error(`Track "${trackKey}" has no notes.`);
            
            gameElements.background.style.backgroundImage = `url('${songInfo.backgroundUrl || ''}')`;
            gameElements.albumArt.src = songInfo.albumArtUrl || '';
            gameElements.songTitle.textContent = parsedChart.metadata.Name;
            gameElements.songArtist.textContent = parsedChart.metadata.Artist;

            updateLoadingText('Starting Game...');
            resetGameState(notes);
            
            const audioOffset = parsedChart.metadata.Offset || 0;
            const startTime = Tone.now() + 1;
            
            Tone.Transport.start(startTime, audioOffset);
            audioPlayers.get("song").start(startTime);

            setTimeout(() => {
                navigateTo('game');
                gameState = 'playing';
                gameLoopId = requestAnimationFrame(gameLoop);
            }, 1000);

        } catch (error) {
            console.error("--- FATAL: Could not start game ---", error);
            alert(`Failed to start game: ${error.message}`);
            cleanupAudio();
            navigateTo('songSelect');
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

    const gameLoop = () => {
        if (gameState !== 'playing') {
             cancelAnimationFrame(gameLoopId);
             return;
        }
        const currentTime = Tone.Transport.seconds;
        
        activeTrack.notes.forEach(note => {
            const noteAppearanceTime = note.time - NOTE_FALL_DURATION_S;
            if (!note.spawned && currentTime >= noteAppearanceTime) {
                spawnNote(note);
            } 
            
            if (note.spawned && !note.hit && !note.missed) {
                if (note.time - currentTime < -HIT_WINDOW_S) {
                    missNote(note);
                } else {
                    updateNotePosition(note, currentTime);
                }
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
        multiplier = [1, 2, 3, 4][Math.min(Math.floor(combo / 10), 3)];
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

    const pauseGame = () => {
        if(gameState !== 'playing') return;
        gameState = 'paused';
        Tone.Transport.pause();
        cancelAnimationFrame(gameLoopId);
        screens.pause.classList.add('active');
    }

    const resumeGame = () => {
        if(gameState !== 'paused') return;
        gameState = 'playing';
        Tone.Transport.start();
        gameLoopId = requestAnimationFrame(gameLoop);
        screens.pause.classList.remove('active');
    }

    // --- INITIALIZATION ---
    const initialize = () => {
        screens.splash.addEventListener('click', async () => {
            await Tone.start();
            navigateTo('mainMenu');
        }, { once: true });
        
        buttons.playSetlist.addEventListener('click', loadSetlist);
        buttons.backToMenu.addEventListener('click', () => navigateTo('songSelect'));
        getElement('back-to-song-select-btn').addEventListener('click', () => navigateTo('songSelect'));
        buttons.quit.addEventListener('click', () => quitGame(false));
        buttons.resume.addEventListener('click', resumeGame);
        buttons.resultsBack.addEventListener('click', () => navigateTo('songSelect'));

        window.addEventListener('keydown', (e) => {
            if (e.repeat) return;
            const key = e.key.toLowerCase();
            if (key === 'escape') {
                if (gameState === 'playing') pauseGame();
                else if (gameState === 'paused') resumeGame();
            }
            if (KEY_MAPPING[key] !== undefined) handleFretPress(KEY_MAPPING[key]);
        });
        window.addEventListener('keyup', (e) => {
            const key = e.key.toLowerCase();
            if (KEY_MAPPING[key] !== undefined) handleFretRelease(KEY_MAPPING[key]);
        });
    };

    initialize();
});
