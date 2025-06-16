document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Element Caching ---
    const screens = {
        splash: document.getElementById('splash-screen'),
        mainMenu: document.getElementById('main-menu'),
        songSelect: document.getElementById('song-select-screen'),
        difficultySelect: document.getElementById('difficulty-select-screen'),
        game: document.getElementById('game-container'),
        loading: document.getElementById('loading-screen'),
        pause: document.getElementById('pause-menu'),
    };

    const buttons = {
        playGame: document.getElementById('play-game-btn'),
        songFolderInput: document.getElementById('song-folder-input'),
        backToMenu: document.getElementById('back-to-menu-btn'),
        backToSongSelect: document.getElementById('back-to-song-select-btn'),
        difficultyOptions: document.getElementById('difficulty-options'),
        resume: document.getElementById('resume-btn'),
        quit: document.getElementById('quit-btn'),
    };

    const gameElements = {
        songCount: document.getElementById('song-count'),
        songList: document.getElementById('song-list'),
        difficultySongTitle: document.getElementById('difficulty-song-title'),
        albumArt: document.getElementById('album-art'),
        songTitle: document.getElementById('game-song-title'),
        songArtist: document.getElementById('game-song-artist'),
        score: document.getElementById('score'),
        combo: document.getElementById('combo'),
        rockMeterFill: document.getElementById('rock-meter-fill'),
        noteContainer: document.getElementById('note-container'),
        frets: document.querySelectorAll('.fret'),
        loadingText: document.getElementById('loading-text'),
    };

    // --- Game State & Configuration ---
    let songs = [];
    let currentSong = null;
    let activeNoteElements = [];
    let scheduledEvents = [];
    let gameState = 'splash';
    let audioPlayers = null;
    
    let score = 0;
    let combo = 0;
    let rockMeter = 50; // Range: 0-100

    const NOTE_SPEED_MS = 1500; // Time in ms for a note to travel the highway.
    const HIT_WINDOW_MS = 100;  // Generous +/- window for hitting a note.
    const FRET_COLORS = ['green', 'red', 'yellow', 'blue', 'orange'];
    const KEY_MAPPING = { 'a': 0, 's': 1, 'd': 2, 'k': 3, 'l': 4 };

    // --- Screen Navigation ---
    function navigateTo(screenName) {
        Object.values(screens).forEach(screen => screen.classList.remove('active'));
        if (screens[screenName]) {
            screens[screenName].classList.add('active');
            gameState = screenName;
        }
    }

    // --- Event Listeners Setup ---
    screens.splash.addEventListener('click', () => {
        Tone.start().then(() => navigateTo('mainMenu'));
    });
    
    buttons.playGame.addEventListener('click', () => {
        if (songs.length > 0) navigateTo('songSelect');
    });
    buttons.backToMenu.addEventListener('click', () => navigateTo('mainMenu'));
    buttons.backToSongSelect.addEventListener('click', () => navigateTo('songSelect'));
    buttons.songFolderInput.addEventListener('change', handleSongFolderSelect);
    buttons.quit.addEventListener('click', endGame);
    buttons.resume.addEventListener('click', resumeGame);

    // --- Song Loading and Parsing ---
    async function handleSongFolderSelect(event) {
        navigateTo('loading');
        gameElements.loadingText.textContent = 'Parsing song files...';

        const files = Array.from(event.target.files);
        const songFolders = {};

        files.forEach(file => {
            const path = file.webkitRelativePath;
            const folderName = path.substring(0, path.indexOf('/'));
            if (!songFolders[folderName]) songFolders[folderName] = [];
            songFolders[folderName].push(file);
        });

        const parsePromises = Object.values(songFolders).map(parseSongFolder);
        const parsedSongs = (await Promise.all(parsePromises)).filter(s => s !== null);
        
        songs.push(...parsedSongs);
        gameElements.songCount.textContent = `${songs.length} song${songs.length !== 1 ? 's' : ''} loaded`;
        renderSongList();
        navigateTo(songs.length > 0 ? 'songSelect' : 'mainMenu');
    }

    async function parseSongFolder(files) {
        try {
            const song = {
                name: 'Unknown Song', artist: 'Unknown Artist',
                albumArtUrl: 'https://placehold.co/300x300/111/fff?text=No+Art',
                audioUrls: {}, notesByTrack: {}, availableParts: {}
            };

            const iniFile = files.find(f => f.name.toLowerCase() === 'song.ini');
            if (iniFile) {
                const iniData = parseIni(await iniFile.text());
                song.name = iniData.song?.name || song.name;
                song.artist = iniData.song?.artist || song.artist;
            }

            const artFile = files.find(f => f.name.toLowerCase().match(/album\.(jpg|jpeg|png)$/));
            if (artFile) song.albumArtUrl = URL.createObjectURL(artFile);
            
            files.filter(f => f.name.toLowerCase().endsWith('.opus')).forEach(f => {
                const stemName = f.name.replace('.opus', '');
                song.audioUrls[stemName] = URL.createObjectURL(f);
            });

            const midiFile = files.find(f => f.name.toLowerCase() === 'notes.mid');
            if (midiFile) {
                const midiData = await midiFile.arrayBuffer();
                const parsedMidi = MidiParser.parse(midiData);
                const { notesByTrack, availableParts } = processMidi(parsedMidi);
                song.notesByTrack = notesByTrack;
                song.availableParts = availableParts;
            }
            
            if (Object.keys(song.availableParts).length === 0 || Object.keys(song.audioUrls).length === 0) return null;
            return song;
        } catch (error) {
            console.error("Failed to parse song folder:", files[0]?.webkitRelativePath, error);
            return null;
        }
    }
    
    function parseIni(text) {
        return text.split('\n').reduce((acc, line) => {
            line = line.trim();
            if (line.startsWith('[') && line.endsWith(']')) {
                acc.currentSection = line.substring(1, line.length - 1).toLowerCase();
                acc.data[acc.currentSection] = {};
            } else if (acc.currentSection && line.includes('=')) {
                const [key, val] = line.split('=').map(s => s.trim());
                acc.data[acc.currentSection][key] = val;
            }
            return acc;
        }, { data: {}, currentSection: null }).data;
    }

    function processMidi(parsedMidi) {
        const ticksPerBeat = parsedMidi.timeDivision;
        const notesByTrack = {};
        const availableParts = {};
        let tempoChanges = [{ ticks: 0, bpm: 120 }];

        // First pass: get all tempo changes
        parsedMidi.track[0].event.forEach(event => {
            if (event.type === 8 && event.metaType === 81) { // Set Tempo
                const mpq = (event.data[0] << 16) | (event.data[1] << 8) | event.data[2];
                tempoChanges.push({ ticks: event.deltaTime, bpm: 60000000 / mpq });
            }
        });
        
        // Accumulate delta times for tempo changes
        let accumulatedTicks = 0;
        tempoChanges = tempoChanges.map(t => {
            accumulatedTicks += t.ticks;
            return { ticks: accumulatedTicks, bpm: t.bpm };
        });

        const ticksToSeconds = (ticks) => {
            let time = 0;
            let lastTicks = 0;
            let lastBpm = 120;
            for(const change of tempoChanges) {
                if (ticks < change.ticks) break;
                time += ((change.ticks - lastTicks) / ticksPerBeat) * (60 / lastBpm);
                lastTicks = change.ticks;
                lastBpm = change.bpm;
            }
            time += ((ticks - lastTicks) / ticksPerBeat) * (60 / lastBpm);
            return time;
        };

        const instrumentMapping = {
            'PART GUITAR': { name: 'Guitar', difficulties: { 'expert': [96, 100] } },
            'PART BASS': { name: 'Bass', difficulties: { 'expert': [96, 100] } },
            // Add more instruments and difficulties here
        };

        parsedMidi.track.forEach(track => {
            const trackNameEvent = track.event.find(e => e.type === 3);
            if (!trackNameEvent) return;

            const trackName = trackNameEvent.data;
            const instrument = instrumentMapping[trackName];
            if (!instrument) return;

            Object.keys(instrument.difficulties).forEach(diff => {
                const [min, max] = instrument.difficulties[diff];
                const notes = [];
                let currentTicks = 0;

                track.event.forEach(event => {
                    currentTicks += event.deltaTime;
                    if (event.type === 9) { // Note On
                        const pitch = event.data[0];
                        if (pitch >= min && pitch <= max) {
                            notes.push({
                                time: ticksToSeconds(currentTicks),
                                fret: pitch - min,
                                duration: 0, // Implement duration later
                            });
                        }
                    }
                });

                if (notes.length > 0) {
                    if (!availableParts[instrument.name]) availableParts[instrument.name] = [];
                    availableParts[instrument.name].push(diff);
                    notesByTrack[`${instrument.name}_${diff}`] = notes;
                }
            });
        });
        return { notesByTrack, availableParts };
    }

    function renderSongList() {
        gameElements.songList.innerHTML = '';
        songs.forEach(song => {
            const item = document.createElement('div');
            item.className = 'song-item';
            item.innerHTML = `<b>${song.name}</b><br>${song.artist}`;
            item.onclick = () => {
                currentSong = song;
                gameElements.difficultySongTitle.textContent = `${song.artist} - ${song.name}`;
                renderDifficultyOptions(song.availableParts);
                navigateTo('difficultySelect');
            };
            gameElements.songList.appendChild(item);
        });
    }

    function renderDifficultyOptions(parts) {
        buttons.difficultyOptions.innerHTML = '';
        Object.keys(parts).forEach(instrument => {
            parts[instrument].forEach(difficulty => {
                const btn = document.createElement('button');
                btn.className = 'menu-btn';
                btn.textContent = `${instrument} - ${difficulty}`;
                btn.onclick = () => startGame(`${instrument}_${difficulty}`);
                buttons.difficultyOptions.appendChild(btn);
            });
        });
    }

    // --- GAMEPLAY ---
    async function startGame(trackKey) {
        navigateTo('loading');
        gameElements.loadingText.textContent = 'Loading audio...';
        
        await Tone.Transport.cancel();
        await Tone.Transport.stop();
        if(audioPlayers) await audioPlayers.dispose();
        
        const noteTrack = currentSong.notesByTrack[trackKey];
        activeNoteElements = [];
        noteTrack.forEach(n => { n.spawned = false; n.hit = false; });
        
        gameElements.albumArt.src = currentSong.albumArtUrl;
        gameElements.songTitle.textContent = currentSong.name;
        gameElements.songArtist.textContent = currentSong.artist;
        
        audioPlayers = new Tone.Players(currentSong.audioUrls, () => {
            Object.values(audioPlayers.players).forEach(player => player.toDestination());
            
            scheduledEvents.forEach(id => Tone.Transport.clear(id));
            scheduledEvents = [];

            noteTrack.forEach(note => {
                const eventId = Tone.Transport.scheduleOnce(time => {
                    if (gameState === 'playing') {
                       spawnNote(note, time);
                    }
                }, note.time);
                scheduledEvents.push(eventId);
            });
            
            resetGameState();
            navigateTo('game');
            Tone.Transport.start();
            requestAnimationFrame(gameLoop);
        }).toDestination();
    }

    function resetGameState() {
        score = 0;
        combo = 0;
        rockMeter = 50;
        updateUI();
    }

    function spawnNote(noteData) {
        const noteEl = document.createElement('div');
        noteEl.className = `note ${FRET_COLORS[noteData.fret]}`;
        noteEl.style.left = `${noteData.fret * 20}%`;
        noteEl.style.top = `-5%`; // Start off-screen
        gameElements.noteContainer.appendChild(noteEl);

        noteData.element = noteEl;
        activeNoteElements.push(noteData);
    }
    
    function gameLoop(timestamp) {
        if (gameState !== 'playing') return;

        const currentTime = Tone.Transport.seconds;

        activeNoteElements.forEach((note, index) => {
            const timeUntilHit = note.time - currentTime;
            
            if (timeUntilHit < -HIT_WINDOW_MS / 1000 && !note.hit) {
                missNote(note, index);
            } else {
                const progress = 1 - (timeUntilHit / (NOTE_SPEED_MS / 1000));
                note.element.style.transform = `translateZ(${progress * 600}px)`;
            }
        });

        // Remove notes that have been processed
        activeNoteElements = activeNoteElements.filter(n => n.element.parentElement);
        
        requestAnimationFrame(gameLoop);
    }

    function handleFretPress(fretIndex) {
        if (gameState !== 'playing') return;

        gameElements.frets[fretIndex].classList.add('active');
        
        const currentTime = Tone.Transport.seconds;
        const hitWindowSec = HIT_WINDOW_MS / 1000;
        
        let bestNote = null;
        let bestNoteIndex = -1;
        let smallestTimeDiff = Infinity;

        activeNoteElements.forEach((note, index) => {
            if (note.data.fret === fretIndex && !note.hit) {
                const timeDiff = Math.abs(currentTime - note.time);
                if (timeDiff <= hitWindowSec && timeDiff < smallestTimeDiff) {
                    smallestTimeDiff = timeDiff;
                    bestNote = note;
                    bestNoteIndex = index;
                }
            }
        });
        
        if (bestNote) {
            hitNote(bestNote, bestNoteIndex);
        }
    }
    
    function handleFretRelease(fretIndex) {
         gameElements.frets[fretIndex].classList.remove('active');
    }

    function hitNote(note, index) {
        note.hit = true;
        note.element.remove();
        
        combo++;
        score += 100 * (1 + Math.floor(combo / 10));
        rockMeter = Math.min(100, rockMeter + 1.5);
        updateUI();
    }

    function missNote(note, index) {
        note.hit = true; // Mark as processed
        note.element.style.opacity = '0.3'; // Fade out missed note
        setTimeout(() => note.element.remove(), 200);

        combo = 0;
        rockMeter = Math.max(0, rockMeter - 4);
        updateUI();
        
        if (rockMeter <= 0) {
            endGame(true); // Game over
        }
    }
    
    function updateUI() {
        gameElements.score.textContent = score;
        gameElements.combo.textContent = `${combo}x`;
        gameElements.rockMeterFill.style.width = `${rockMeter}%`;
    }

    function pauseGame() {
        if (gameState !== 'playing') return;
        Tone.Transport.pause();
        gameState = 'paused';
        screens.pause.classList.add('active');
    }
    
    function resumeGame(){
        if(gameState !== 'paused') return;
        screens.pause.classList.remove('active');
        gameState = 'playing';
        Tone.Transport.start();
        requestAnimationFrame(gameLoop);
    }
    
    function endGame(failed = false) {
        Tone.Transport.stop();
        if (audioPlayers) {
            audioPlayers.dispose();
            audioPlayers = null;
        }
        scheduledEvents.forEach(id => Tone.Transport.clear(id));
        scheduledEvents = [];
        gameElements.noteContainer.innerHTML = ''; // Clear leftover notes
        
        if (failed) {
            alert('You failed!');
        }
        
        navigateTo('songSelect');
    }

    // --- Input Handling ---
    window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        if (KEY_MAPPING[e.key] !== undefined) handleFretPress(KEY_MAPPING[e.key]);
        if (e.key === "Escape") {
             if(gameState === 'playing') pauseGame();
             else if (gameState === 'paused') resumeGame();
        }
    });

    window.addEventListener('keyup', (e) => {
        if (KEY_MAPPING[e.key] !== undefined) handleFretRelease(KEY_MAPPING[e.key]);
    });

    gameElements.frets.forEach((fret, index) => {
        fret.addEventListener('touchstart', (e) => { e.preventDefault(); handleFretPress(index); }, { passive: false });
        fret.addEventListener('touchend', (e) => { e.preventDefault(); handleFretRelease(index); });
    });
});
