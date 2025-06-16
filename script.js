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
        settings: document.getElementById('settings-btn'),
        songFolderInput: document.getElementById('song-folder-input'),
        songFolderLabel: document.querySelector('label[for="song-folder-input"]'),
        backToMenu: document.getElementById('back-to-menu-btn'),
        backToSongSelect: document.getElementById('back-to-song-select-btn'),
        difficultyOptions: document.getElementById('difficulty-options'),
        resume: document.getElementById('resume-btn'),
        quit: document.getElementById('quit-btn'),
    };
    
    const gameElements = {
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
    };

    // --- Game State & Configuration ---
    let songs = [];
    let currentSong = null;
    let activeNotes = [];
    let gameState = 'splash'; // splash, menu, song-select, difficulty-select, loading, playing, paused, results
    let gameLoopId = null;
    
    // Game metrics
    let score = 0;
    let combo = 0;
    let rockMeter = 50; // 0-100 scale

    // Audio players
    let audioPlayers = {};
    const NOTE_SPEED = 1.5; // seconds for a note to travel the highway

    // --- Screen Navigation ---
    function navigateTo(screenName) {
        Object.values(screens).forEach(screen => screen.classList.remove('active'));
        if (screens[screenName]) {
            screens[screenName].classList.add('active');
            gameState = screenName;
        }
    }
    
    // --- Initial Setup ---
    screens.splash.addEventListener('click', () => {
        Tone.start();
        navigateTo('mainMenu');
    });
    
    buttons.playGame.addEventListener('click', () => navigateTo('songSelect'));
    buttons.backToMenu.addEventListener('click', () => navigateTo('mainMenu'));
    buttons.backToSongSelect.addEventListener('click', () => navigateTo('songSelect'));
    buttons.songFolderInput.addEventListener('change', handleSongFolderSelect);
    
    // --- Song Loading & Parsing ---
    async function handleSongFolderSelect(event) {
        navigateTo('loading');
        const files = Array.from(event.target.files);
        const songFolders = {};

        // Group files by their parent directory
        files.forEach(file => {
            const path = file.webkitRelativePath;
            const folderName = path.substring(0, path.indexOf('/'));
            if (!songFolders[folderName]) {
                songFolders[folderName] = [];
            }
            songFolders[folderName].push(file);
        });

        const parsedSongs = await Promise.all(Object.values(songFolders).map(parseSongFolder));
        songs = parsedSongs.filter(s => s !== null); // Filter out any failed parses
        
        renderSongList();
        navigateTo('songSelect');
    }

    async function parseSongFolder(folderFiles) {
        try {
            const song = {
                name: "Unknown Song",
                artist: "Unknown Artist",
                albumArt: 'https://placehold.co/300x300/111/fff?text=No+Art',
                audio: {},
                notes: null,
            };

            // Find and process song.ini
            const iniFile = folderFiles.find(f => f.name.toLowerCase() === 'song.ini');
            if (iniFile) {
                const iniText = await iniFile.text();
                const iniData = parseIni(iniText);
                song.name = iniData.song?.name || song.name;
                song.artist = iniData.song?.artist || song.artist;
            }

            // Find album art
            const artFile = folderFiles.find(f => f.name.toLowerCase().match(/album\.(jpg|jpeg|png)$/));
            if (artFile) {
                song.albumArt = URL.createObjectURL(artFile);
            }
            
            // Find audio files
            const audioFiles = folderFiles.filter(f => f.name.toLowerCase().endsWith('.opus'));
            audioFiles.forEach(file => {
                const stemName = file.name.replace('.opus', '');
                song.audio[stemName] = URL.createObjectURL(file);
            });

            // Find and parse MIDI file
            const midiFile = folderFiles.find(f => f.name.toLowerCase() === 'notes.mid');
            if (midiFile) {
                const midiData = await midiFile.arrayBuffer();
                const parsedMidi = MidiParser.parse(midiData);
                song.notes = processMidi(parsedMidi);
            }
            
            if (!song.notes || Object.keys(song.audio).length === 0) return null;

            return song;
        } catch (error) {
            console.error("Error parsing song folder:", error);
            return null;
        }
    }

    function parseIni(text) {
        const lines = text.split('\n');
        const data = {};
        let currentSection = null;
        lines.forEach(line => {
            line = line.trim();
            if (line.startsWith('[') && line.endsWith(']')) {
                currentSection = line.substring(1, line.length - 1);
                data[currentSection] = {};
            } else if (currentSection && line.includes('=')) {
                const [key, ...valueParts] = line.split('=');
                data[currentSection][key.trim()] = valueParts.join('=').trim();
            }
        });
        return data;
    }

    function processMidi(parsedMidi) {
        const ticksPerBeat = parsedMidi.timeDivision;
        let tempo = 120; // Default BPM
        const notesByTrack = {};

        parsedMidi.track.forEach(track => {
            let currentTime = 0;
            const trackName = track.event.find(e => e.type === 3)?.data; // Track Name event
            if (!trackName) return;

            notesByTrack[trackName] = [];

            track.event.forEach(event => {
                currentTime += event.deltaTime;
                if (event.type === 8 && event.metaType === 81) { // Set Tempo event
                    tempo = 60000000 / (event.data[0] << 16 | event.data[1] << 8 | event.data[2]);
                } else if (event.type === 9) { // Note On
                    const timeInSeconds = (currentTime / ticksPerBeat) * (60 / tempo);
                    // Map MIDI note number to fret index (example mapping)
                    let fret = -1;
                    if (event.data[0] >= 60 && event.data[0] <= 64) fret = event.data[0] - 60; // Expert Guitar
                    // ... add more mappings for other instruments/difficulties
                    
                    if(fret !== -1){
                         notesByTrack[trackName].push({ time: timeInSeconds, fret: fret, duration: 0, spawned: false });
                    }
                }
            });
        });
        return notesByTrack;
    }


    function renderSongList() {
        gameElements.songList.innerHTML = '';
        songs.forEach(song => {
            const item = document.createElement('div');
            item.className = 'song-item';
            item.textContent = `${song.artist} - ${song.name}`;
            item.onclick = () => {
                currentSong = song;
                gameElements.difficultySongTitle.textContent = `${song.artist} - ${song.name}`;
                navigateTo('difficultySelect');
            };
            gameElements.songList.appendChild(item);
        });
    }
    
    // --- Game Logic ---

    buttons.difficultyOptions.addEventListener('click', (e) => {
        if (e.target.classList.contains('difficulty-btn')) {
            // In a real game, you'd select a specific note track here.
            // For now, we'll just use the first available one.
            const trackName = Object.keys(currentSong.notes).find(name => name.includes('GUITAR'));
            if(trackName){
                startGame(currentSong.notes[trackName]);
            } else {
                alert("No guitar track found for this song.");
            }
        }
    });

    async function startGame(noteTrack) {
        navigateTo('loading');
        await Tone.Transport.cancel();
        if(Object.keys(audioPlayers).length > 0) {
            Object.values(audioPlayers).forEach(p => p.dispose());
        }
        
        activeNotes = [];
        noteTrack.forEach(n => n.spawned = false); // Reset spawn state
        
        // Setup audio
        audioPlayers = new Tone.Players(currentSong.audio, () => {
            Object.values(audioPlayers.players).forEach(player => player.toDestination());
            
            // Schedule all notes
            noteTrack.forEach(note => {
                Tone.Transport.scheduleOnce((time) => {
                    spawnNote(note, time);
                }, note.time - NOTE_SPEED);
            });
            
            // Start game
            score = 0;
            combo = 0;
            rockMeter = 50;
            updateUI();
            
            navigateTo('game');
            Tone.Transport.start();
        }).toDestination();
    }
    
    function spawnNote(noteData, scheduledTime){
        const noteEl = document.createElement('div');
        noteEl.className = 'note';
        noteEl.style.left = `${16.66 * noteData.fret + 2.5}%`; // Center note in the lane
        noteEl.style.backgroundColor = `var(--fret-${['green', 'red', 'yellow', 'blue', 'orange'][noteData.fret]})`;
        noteEl.style.animationDuration = `${NOTE_SPEED}s`;
        noteEl.dataset.time = noteData.time;

        gameElements.noteContainer.appendChild(noteEl);
        
        activeNotes.push({element: noteEl, data: noteData});

        // Cleanup note after it's gone
        setTimeout(() => {
             if(noteEl.parentElement){
                noteEl.remove();
                const index = activeNotes.findIndex(n => n.element === noteEl);
                if(index > -1) {
                    activeNotes.splice(index, 1);
                    if(gameState === 'playing') missNote();
                }
             }
        }, NOTE_SPEED * 1000 + 200); // add a buffer
    }
    
    function handleFretPress(fretIndex) {
        if (gameState !== 'playing') return;

        frets[fretIndex].classList.add('active');
        
        const hitTime = Tone.now();
        const hitWindow = 0.1; // 100ms window
        
        let hit = false;
        for (let i = activeNotes.length - 1; i >= 0; i--) {
            const note = activeNotes[i];
            if (note.data.fret === fretIndex) {
                const noteTime = note.data.time;
                if (Math.abs(hitTime - noteTime) <= hitWindow) {
                    hitNote(note);
                    activeNotes.splice(i, 1);
                    hit = true;
                    break;
                }
            }
        }
    }
    
    function handleFretRelease(fretIndex) {
         frets[fretIndex].classList.remove('active');
    }

    function hitNote(note) {
        note.element.remove();
        combo++;
        score += 10 * combo;
        rockMeter = Math.min(100, rockMeter + 2);
        updateUI();
    }

    function missNote() {
        combo = 0;
        rockMeter = Math.max(0, rockMeter - 5);
        if (rockMeter === 0) {
            // You failed!
            endGame();
        }
        updateUI();
    }
    
    function endGame(){
        Tone.Transport.stop();
        Object.values(audioPlayers).forEach(p => p.dispose());
        navigateTo('songSelect'); // Or a results screen
    }

    function updateUI() {
        gameElements.score.textContent = score;
        gameElements.combo.textContent = combo;
        gameElements.rockMeterFill.style.width = `${rockMeter}%`;
    }

    // --- Input Handling ---
    const keyMapping = { 'a': 0, 's': 1, 'd': 2, 'k': 3, 'l': 4 };
    window.addEventListener('keydown', (e) => {
        if(e.repeat) return;
        if (keyMapping[e.key] !== undefined) handleFretPress(keyMapping[e.key]);
        if(e.key === "Escape" && gameState === 'playing') pauseGame();
    });
     window.addEventListener('keyup', (e) => {
        if (keyMapping[e.key] !== undefined) handleFretRelease(keyMapping[e.key]);
    });

    frets.forEach((fret, index) => {
        fret.addEventListener('touchstart', (e) => { e.preventDefault(); handleFretPress(index); }, { passive: false });
        fret.addEventListener('touchend', (e) => { e.preventDefault(); handleFretRelease(index); });
    });
    
    // --- Pause Menu ---
    function pauseGame() {
        if (gameState !== 'playing') return;
        Tone.Transport.pause();
        screens.pause.classList.add('active');
        gameState = 'paused';
    }

    buttons.resume.addEventListener('click', () => {
        if (gameState !== 'paused') return;
        Tone.Transport.start();
        screens.pause.classList.remove('active');
        gameState = 'playing';
    });

    buttons.quit.addEventListener('click', () => {
        endGame();
    });

});
