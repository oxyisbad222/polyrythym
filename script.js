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
        results: document.getElementById('results-screen'),
    };

    const buttons = {
        playGame: document.getElementById('play-game-btn'),
        songFolderInput: document.getElementById('song-folder-input'),
        backToMenu: document.getElementById('back-to-menu-btn'),
        backToSongSelect: document.getElementById('back-to-song-select-btn'),
        difficultyOptions: document.getElementById('difficulty-options'),
        resume: document.getElementById('resume-btn'),
        quit: document.getElementById('quit-btn'),
        resultsBack: document.getElementById('results-back-btn'),
    };
    
    const gameElements = {
        songCount: document.getElementById('song-count'),
        songList: document.getElementById('song-list'),
        difficultySongTitle: document.getElementById('difficulty-song-title'),
        albumArt: document.getElementById('album-art'),
        songTitle: document.getElementById('game-song-title'),
        songArtist: document.getElementById('game-song-artist'),
        score: document.getElementById('score'),
        multiplier: document.getElementById('multiplier'),
        combo: document.getElementById('combo'),
        rockMeterFill: document.getElementById('rock-meter-fill'),
        starPowerFill: document.getElementById('star-power-fill'),
        noteContainer: document.getElementById('note-container'),
        highway: document.getElementById('highway'),
        frets: document.querySelectorAll('.fret'),
        loadingText: document.getElementById('loading-text'),
        menuMusicCard: document.getElementById('menu-music-card'),
        menuMusicAlbumArt: document.getElementById('menu-music-album-art'),
        menuMusicTitle: document.getElementById('menu-music-title'),
        menuMusicArtist: document.getElementById('menu-music-artist'),
        menuMusicYear: document.getElementById('menu-music-year'),
        resultsSongInfo: document.getElementById('results-song-info'),
        resultsScore: document.getElementById('results-score'),
        resultsNotesHit: document.getElementById('results-notes-hit'),
        resultsTotalNotes: document.getElementById('results-total-notes'),
        resultsAccuracy: document.getElementById('results-accuracy'),
        resultsMaxCombo: document.getElementById('results-max-combo'),
    };

    // --- Game State & Configuration ---
    let songs = [];
    let currentSongData = null;
    let activeTrack = { notes: [], totalNotes: 0 };
    let gameState = 'splash';
    let audioPlayers = null;
    let menuMusicPlayer = null;

    let score, combo, maxCombo, notesHit, multiplier, rockMeter, starPower;
    let isStarPowerActive = false;
    
    let gameLoopId = null;
    let scheduledEvents = [];

    const NOTE_SPEED_MS = 1500;
    const HIT_WINDOW_MS = 80;
    const KEY_MAPPING = { 'a': 0, 's': 1, 'd': 2, 'k': 3, 'l': 4, ' ': 'sp' };
    const MULTIPLIER_STAGES = [1, 2, 3, 4];
    const NOTES_PER_MULTIPLIER = 10;
    const MENU_MUSIC = [
        { title: "Enter Sandman", artist: "Metallica", year: "1991", url: "https://p.scdn.co/mp3-preview/5458066a524a138c53874136606a5b882313624e?cid=774b29d4f13844c495f206cafdad9c86" },
        { title: "Welcome to the Jungle", artist: "Guns N' Roses", year: "1987", url: "https://p.scdn.co/mp3-preview/a392a81977579c3af7b822d56a3196903a450518?cid=774b29d4f13844c495f206cafdad9c86" },
        { title: "Smells Like Teen Spirit", artist: "Nirvana", year: "1991", url: "https://p.scdn.co/mp3-preview/2b5276323a233b8431e7845210214c7efa826de6?cid=774b29d4f13844c495f206cafdad9c86" },
    ];

    // --- Core Game Flow & Screen Navigation ---
    function navigateTo(screenName) {
        Object.values(screens).forEach(s => s.classList.remove('active'));
        screens[screenName]?.classList.add('active');
        gameState = screenName;
    }

    screens.splash.addEventListener('click', async () => {
        await Tone.start();
        playMenuMusic();
        navigateTo('mainMenu');
    });
    
    buttons.playGame.addEventListener('click', () => songs.length > 0 && navigateTo('songSelect'));
    buttons.backToMenu.addEventListener('click', () => navigateTo('mainMenu'));
    buttons.backToSongSelect.addEventListener('click', () => navigateTo('songSelect'));
    buttons.songFolderInput.addEventListener('change', handleSongFolderSelect);
    buttons.quit.addEventListener('click', endGame);
    buttons.resume.addEventListener('click', resumeGame);
    buttons.resultsBack.addEventListener('click', () => navigateTo('songSelect'));

    // --- Menu Music ---
    function playMenuMusic() {
        if (menuMusicPlayer) menuMusicPlayer.dispose();
        const randomSong = MENU_MUSIC[Math.floor(Math.random() * MENU_MUSIC.length)];
        
        menuMusicPlayer = new Tone.Player(randomSong.url).toDestination();
        menuMusicPlayer.autostart = true;
        menuMusicPlayer.loop = true;

        gameElements.menuMusicTitle.textContent = randomSong.title;
        gameElements.menuMusicArtist.textContent = randomSong.artist;
        gameElements.menuMusicYear.textContent = randomSong.year;
        gameElements.menuMusicAlbumArt.style.backgroundImage = `url(https://placehold.co/80x80/111/fff?text=${randomSong.artist.charAt(0)})`;
        gameElements.menuMusicCard.classList.add('visible');
    }

    // --- Song Loading & MIDI Processing ---
    async function handleSongFolderSelect(event) {
        navigateTo('loading');
        gameElements.loadingText.textContent = 'Parsing song files...';
        const files = Array.from(event.target.files);
        const folders = {};
        files.forEach(file => {
            const folderName = file.webkitRelativePath.split('/')[0];
            if (!folders[folderName]) folders[folderName] = [];
            folders[folderName].push(file);
        });

        const parsedSongs = (await Promise.all(Object.values(folders).map(parseSongFolder))).filter(Boolean);
        songs.push(...parsedSongs);
        gameElements.songCount.textContent = `${songs.length} song${songs.length !== 1 ? 's' : ''} loaded`;
        buttons.playGame.disabled = songs.length === 0;
        renderSongList();
        navigateTo(songs.length > 0 ? 'songSelect' : 'mainMenu');
    }

    async function parseSongFolder(files) {
        try {
            const song = {
                name: files[0].webkitRelativePath.split('/')[0], artist: 'Unknown', year: 'N/A',
                albumArtUrl: 'https://placehold.co/300x300/111/fff?text=No+Art',
                audioUrls: {}, notesByTrack: {}, availableParts: {}
            };
            const iniFile = files.find(f => f.name.toLowerCase() === 'song.ini');
            if (iniFile) Object.assign(song, parseIni(await iniFile.text()));
            
            const artFile = files.find(f => f.name.toLowerCase().match(/album\.(jpg|jpeg|png)$/));
            if (artFile) song.albumArtUrl = URL.createObjectURL(artFile);
            
            files.filter(f => f.name.endsWith('.opus')).forEach(f => song.audioUrls[f.name.replace('.opus', '')] = URL.createObjectURL(f));

            const midiFile = files.find(f => f.name.toLowerCase() === 'notes.mid');
            if (midiFile) Object.assign(song, processMidi(await midiFile.arrayBuffer()));
            
            if (Object.keys(song.availableParts).length === 0 || Object.keys(song.audioUrls).length === 0) return null;
            return song;
        } catch (error) { console.error("Error parsing song folder:", error); return null; }
    }

    function parseIni(text) {
        const data = {};
        const section = text.match(/\[song\]\s*([\s\S]*?)(?=\s*\[|$)/i);
        if(section){
             section[1].split('\n').forEach(line => {
                if (line.includes('=')) {
                    const [key, val] = line.split('=').map(s => s.trim());
                    if (key && val) data[key] = val;
                }
            });
        }
        return data;
    }

    function processMidi(midiBuffer) {
        const midi = MidiParser.parse(midiBuffer);
        const ticksPerBeat = midi.timeDivision;
        const notesByTrack = {};
        const availableParts = {};
        
        let tempo = 120;
        const expertGuitarNotes = [60, 61, 62, 63, 64];
        const expertStarPower = 116;

        midi.track.forEach(track => {
            const trackNameEvent = track.event.find(e => e.type === 3);
            if (!trackNameEvent || !trackNameEvent.data.includes('GUITAR')) return; // Simplified for guitar

            const notes = [];
            let currentTicks = 0;
            let starPowerActive = false;

            track.event.forEach(event => {
                currentTicks += event.deltaTime;
                const time = (currentTicks / ticksPerBeat) * (60 / tempo);

                if (event.type === 9) { // Note On
                    const pitch = event.data[0];
                    const fretIndex = expertGuitarNotes.indexOf(pitch);
                    
                    if (fretIndex !== -1) {
                        notes.push({ time, fret: fretIndex, isStar: starPowerActive, duration: 0, spawned: false, hit: false, missed: false });
                    } else if (pitch === expertStarPower) {
                        starPowerActive = true;
                    }
                } else if (event.type === 8) { // Note Off
                     if (event.data[0] === expertStarPower) starPowerActive = false;
                }
            });

            if (notes.length > 0) {
                const partName = "Guitar - Expert"; // Simplified
                notesByTrack[partName] = notes.sort((a,b) => a.time - b.time);
                availableParts['Guitar'] = ['Expert'];
            }
        });
        return { notesByTrack, availableParts };
    }

    // --- UI Rendering ---
    function renderSongList() {
        gameElements.songList.innerHTML = '';
        songs.forEach(song => {
            const item = document.createElement('div');
            item.className = 'song-item';
            item.innerHTML = `<b>${song.name}</b><br>${song.artist}`;
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
            difficulties.forEach(difficulty => {
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
        if (menuMusicPlayer) menuMusicPlayer.stop();
        if(audioPlayers) await audioPlayers.dispose();
        
        activeTrack.notes = currentSongData.notesByTrack[trackKey];
        activeTrack.totalNotes = activeTrack.notes.length;
        activeTrack.notes.forEach(n => { n.spawned = n.hit = n.missed = false; delete n.element; });
        
        gameElements.albumArt.src = currentSongData.albumArtUrl;
        gameElements.songTitle.textContent = currentSongData.name;
        gameElements.songArtist.textContent = currentSongData.artist;
        
        audioPlayers = new Tone.Players(currentSongData.audioUrls, () => {
            Object.values(audioPlayers.players).forEach(p => p.toDestination());
            
            resetGameState();
            navigateTo('game');
            Tone.Transport.start();
            gameLoopId = requestAnimationFrame(gameLoop);
        }).toDestination();
    }
    
    function resetGameState() {
        score = 0;
        combo = 0;
        maxCombo = 0;
        notesHit = 0;
        multiplier = 1;
        rockMeter = 50;
        starPower = 0;
        isStarPowerActive = false;
        gameElements.highway.classList.remove('star-power-active');
        updateUI();
    }

    function gameLoop() {
        if (gameState !== 'playing') return;
        const currentTime = Tone.Transport.seconds;

        activeTrack.notes.forEach(note => {
            if (!note.spawned && note.time - currentTime < (NOTE_SPEED_MS / 1000)) {
                spawnNote(note);
            }
        });

        for (let i = activeNoteElements.length - 1; i >= 0; i--) {
            const note = activeNoteElements[i];
            const timeUntilHit = note.time - currentTime;
            
            if (timeUntilHit < -(HIT_WINDOW_MS / 1000) && !note.hit) {
                missNote(note);
                activeNoteElements.splice(i, 1);
            } else {
                const progress = 1 - (timeUntilHit / (NOTE_SPEED_MS / 1000));
                note.element.style.transform = `translateY(${progress * 105}vh)`;
            }
        }
        
        gameLoopId = requestAnimationFrame(gameLoop);
    }
    
    function spawnNote(noteData) {
        const noteEl = document.createElement('div');
        noteEl.className = 'note';
        const gem = document.createElement('div');
        gem.className = `note-gem`;
        noteEl.appendChild(gem);
        
        noteEl.classList.add(FRET_COLORS[noteData.fret]);
        if(noteData.isStar) noteEl.classList.add('star-note');

        noteEl.style.left = `${noteData.fret * 20}%`;
        noteEl.style.top = `0%`;
        noteEl.style.animationDuration = `${NOTE_SPEED_MS}ms`;

        noteData.element = noteEl;
        noteData.spawned = true;
        activeNoteElements.push(noteData);
        gameElements.noteContainer.appendChild(noteEl);
    }

    function handleFretPress(fretIndex) {
        if (gameState !== 'playing') return;
        gameElements.frets[fretIndex].classList.add('active');
        
        const currentTime = Tone.Transport.seconds;
        const hitWindowSec = HIT_WINDOW_MS / 1000;
        let noteToHit = null;

        for (const note of activeNoteElements) {
            if (note.fret === fretIndex && !note.hit && !note.missed) {
                if (Math.abs(note.time - currentTime) <= hitWindowSec) {
                    noteToHit = note;
                    break;
                }
            }
        }
        
        if (noteToHit) {
            hitNote(noteToHit);
        }
    }
    
    function handleFretRelease(fretIndex) {
         gameElements.frets[fretIndex].classList.remove('active');
    }

    function hitNote(note) {
        note.hit = true;
        note.element.classList.add('hit');
        setTimeout(() => note.element.remove(), 200);

        combo++;
        if (combo > maxCombo) maxCombo = combo;
        notesHit++;
        multiplier = MULTIPLIER_STAGES[Math.min(Math.floor(combo / NOTES_PER_MULTIPLIER), MULTIPLIER_STAGES.length - 1)];
        score += 50 * (isStarPowerActive ? multiplier * 2 : multiplier);
        rockMeter = Math.min(100, rockMeter + 1);
        if (note.isStar) starPower = Math.min(100, starPower + 3);
        
        updateUI();
    }

    function missNote(note) {
        if(note.hit) return;
        note.missed = true;
        note.element.remove();

        combo = 0;
        multiplier = 1;
        rockMeter = Math.max(0, rockMeter - 8);
        
        if (rockMeter <= 0) endGame(true); // Game Over
        updateUI();
    }
    
    function activateStarPower() {
        if (starPower >= 50 && !isStarPowerActive) {
            isStarPowerActive = true;
            gameElements.highway.classList.add('star-power-active');
            
            const spDuration = Tone.Time("4n").toSeconds() * 8; // 8 beats
            setTimeout(() => {
                isStarPowerActive = false;
                gameElements.highway.classList.remove('star-power-active');
            }, spDuration * 1000);

            let spInterval = setInterval(() => {
                starPower -= 100 / (spDuration * 10);
                if (starPower <= 0) {
                    starPower = 0;
                    isStarPowerActive = false;
                    gameElements.highway.classList.remove('star-power-active');
                    clearInterval(spInterval);
                }
                updateUI();
            }, 100);
        }
    }

    function updateUI() {
        gameElements.score.textContent = score;
        gameElements.combo.textContent = combo;
        gameElements.multiplier.textContent = `${isStarPowerActive ? multiplier * 2 : multiplier}x`;
        gameElements.rockMeterFill.style.width = `${rockMeter}%`;
        gameElements.starPowerFill.style.width = `${starPower}%`;
    }

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
    
    function endGame(failed = false) {
        cancelAnimationFrame(gameLoopId);
        Tone.Transport.stop();
        if (audioPlayers) {
            audioPlayers.dispose();
            audioPlayers = null;
        }
        scheduledEvents.forEach(id => Tone.Transport.clear(id));
        gameElements.noteContainer.innerHTML = '';
        
        if (!failed) {
            showResults();
        } else {
            alert('YOU FAILED!');
            navigateTo('songSelect');
        }
        playMenuMusic();
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
    window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        const key = e.key.toLowerCase();
        if (KEY_MAPPING[key] !== undefined) {
            if(KEY_MAPPING[key] === 'sp') activateStarPower();
            else handleFretPress(KEY_MAPPING[key]);
        }
        if (key === "escape") {
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
    });
});
