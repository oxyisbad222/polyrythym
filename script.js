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
        playSetlist: document.getElementById('play-setlist-btn'),
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
    let activeNoteElements = [];

    let score, combo, maxCombo, notesHit, multiplier, rockMeter, starPower;
    let isStarPowerActive = false;
    
    let gameLoopId = null;

    // IMPORTANT: This is a placeholder URL. Replace it with a link to your own setlist.json file.
    // The file should be hosted on a service that supports CORS (like GitHub Gist, Backblaze B2, etc.)
    const SETLIST_URL = 'https://gist.githubusercontent.com/oxyisbad/4d557c346a6f1955f1f719001880430d/raw/2e7373f7f18576443831850384814b7453488796/setlist.json';

    const NOTE_SPEED_MS = 1500;
    const HIT_WINDOW_MS = 85;
    const KEY_MAPPING = { 'a': 0, 's': 1, 'd': 2, 'k': 3, 'l': 4, ' ': 'sp' };
    const MULTIPLIER_STAGES = [1, 2, 3, 4, 8];
    const NOTES_PER_MULTIPLIER = 10;
    const MENU_MUSIC = [
        { title: "Enter Sandman", artist: "Metallica", year: "1991", url: "https://p.scdn.co/mp3-preview/5458066a524a138c53874136606a5b882313624e?cid=774b29d4f13844c495f206cafdad9c86" },
        { title: "Welcome to the Jungle", artist: "Guns N' Roses", year: "1987", url: "https://p.scdn.co/mp3-preview/a392a81977579c3af7b822d56a3196903a450518?cid=774b29d4f13844c495f206cafdad9c86" },
    ];
    const FRET_COLORS = ['green', 'red', 'yellow', 'blue', 'orange'];
    
    // --- Core Game Flow & Screen Navigation ---
    function navigateTo(screenName) {
        Object.values(screens).forEach(s => s.classList.remove('active'));
        screens[screenName]?.classList.add('active');
        gameState = screenName;
        if(screenName === 'game') gameState = 'playing';
    }

    screens.splash.addEventListener('click', async () => {
        await Tone.start();
        navigateTo('mainMenu');
        playMenuMusic();
    }, { once: true });
    
    buttons.playGame.addEventListener('click', () => songs.length > 0 && navigateTo('songSelect'));
    buttons.playSetlist.addEventListener('click', loadSetlist);
    buttons.songFolderInput.addEventListener('change', handleSongFolderSelect);
    buttons.backToMenu.addEventListener('click', () => navigateTo('mainMenu'));
    buttons.backToSongSelect.addEventListener('click', () => navigateTo('songSelect'));
    buttons.quit.addEventListener('click', endGame);
    buttons.resume.addEventListener('click', resumeGame);
    buttons.resultsBack.addEventListener('click', () => navigateTo('songSelect'));

    // --- Menu Music ---
    function playMenuMusic() {
        if (menuMusicPlayer?.state === 'started' || gameState !== 'mainMenu') return;
        const randomSong = MENU_MUSIC[Math.floor(Math.random() * MENU_MUSIC.length)];
        
        menuMusicPlayer = new Tone.Player(randomSong.url).toDestination();
        menuMusicPlayer.loop = true;
        menuMusicPlayer.autostart = true;
        menuMusicPlayer.onerror = () => { setTimeout(playMenuMusic, 500); };

        gameElements.menuMusicTitle.textContent = randomSong.title;
        gameElements.menuMusicArtist.textContent = randomSong.artist;
        gameElements.menuMusicYear.textContent = randomSong.year;
        gameElements.menuMusicAlbumArt.style.backgroundImage = `url(https://placehold.co/80x80/111111/ffffff?text=${randomSong.artist.charAt(0)})`;
        gameElements.menuMusicCard.classList.add('visible');
    }

    // --- Remote Setlist Loading ---
    async function loadSetlist() {
        navigateTo('loading');
        gameElements.loadingText.textContent = 'Fetching setlist...';
        try {
            const response = await fetch(SETLIST_URL);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const setlist = await response.json();

            gameElements.loadingText.textContent = `Loading ${setlist.length} song(s)...`;
            const parsePromises = setlist.map(parseRemoteSong);
            const parsedSongs = (await Promise.all(parsePromises)).filter(Boolean);

            songs = [...parsedSongs];
            if (songs.length > 0) {
                 buttons.playGame.disabled = false;
                 gameElements.songCount.textContent = `${songs.length} song${songs.length !== 1 ? 's' : ''} from setlist`;
                 renderSongList();
                 navigateTo('songSelect');
            } else {
                gameElements.songCount.textContent = 'Could not load setlist.';
                navigateTo('mainMenu');
            }
        } catch (error) {
            console.error("Could not load setlist:", error);
            gameElements.songCount.textContent = 'Error loading setlist.';
            navigateTo('mainMenu');
        }
    }

    async function parseRemoteSong(songData) {
        try {
            const song = {
                name: songData.name,
                artist: songData.artist,
                albumArtUrl: songData.albumArtUrl,
                audioUrls: songData.audioUrls,
                notesByTrack: {},
                availableParts: {}
            };

            if (songData.chartUrl) {
                const chartResponse = await fetch(songData.chartUrl);
                if (!chartResponse.ok) throw new Error(`Failed to fetch chart: ${songData.chartUrl}`);
                
                if (songData.chartUrl.toLowerCase().endsWith('.chart')) {
                    const chartText = await chartResponse.text();
                    Object.assign(song, parseChart(chartText));
                } else if (songData.chartUrl.toLowerCase().endsWith('.mid')) {
                    const chartBuffer = await chartResponse.arrayBuffer();
                    Object.assign(song, parseMidi(chartBuffer));
                }
            } else {
                 return null;
            }

            if (Object.keys(song.availableParts).length === 0) {
                 return null;
            }
            return song;
        } catch (error) {
            console.error(`Failed to parse remote song "${songData.name}":`, error);
            return null;
        }
    }


    // --- Local Song Loading ---
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

        const parsePromises = Object.values(folders).map(parseSongFolder);
        const parsedSongs = (await Promise.all(parsePromises)).filter(Boolean);
        
        songs.push(...parsedSongs);
        gameElements.songCount.textContent = `${songs.length} song${songs.length !== 1 ? 's' : ''} loaded`;
        buttons.playGame.disabled = songs.length === 0;
        renderSongList();
        navigateTo(songs.length > 0 ? 'songSelect' : 'mainMenu');
    }

    async function parseSongFolder(files) {
        try {
            const song = { name: files[0].webkitRelativePath.split('/')[0], artist: 'Unknown', year: 'N/A', albumArtUrl: 'https://placehold.co/300x300/111/fff?text=No+Art', audioUrls: {}, notesByTrack: {}, availableParts: {} };
            
            const iniFile = files.find(f => f.name.toLowerCase() === 'song.ini');
            if (iniFile) Object.assign(song, parseIni(await iniFile.text()));

            const artFile = files.find(f => f.name.toLowerCase().match(/album\.(jpg|jpeg|png)$/));
            if (artFile) song.albumArtUrl = URL.createObjectURL(artFile);
            
            files.filter(f => f.name.endsWith('.opus') || f.name.endsWith('.ogg') || f.name.endsWith('.mp3')).forEach(f => {
                const stemName = f.name.substring(0, f.name.lastIndexOf('.'));
                song.audioUrls[stemName] = URL.createObjectURL(f);
            });

            const chartFile = files.find(f => f.name.toLowerCase() === 'notes.chart');
            const midiFile = files.find(f => f.name.toLowerCase() === 'notes.mid');

            if (chartFile) {
                const chartData = await chartFile.text();
                Object.assign(song, parseChart(chartData));
            } else if (midiFile) {
                const midiData = await midiFile.arrayBuffer();
                Object.assign(song, parseMidi(midiData));
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
        const sectionMatch = text.match(/\[song\]\s*([\s\S]*?)(?=\s*\[|$)/i);
        if (sectionMatch) {
            sectionMatch[1].split(/\r?\n/).forEach(line => {
                const eqIndex = line.indexOf('=');
                if (eqIndex > -1) {
                    const key = line.substring(0, eqIndex).trim().toLowerCase();
                    const val = line.substring(eqIndex + 1).trim();
                    if (key && val) data[key] = val;
                }
            });
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
            'PART GUITAR': {
                name: 'Guitar',
                difficulties: {
                    'Expert': { base: 96, name: 'Guitar - Expert' }, 'Hard': { base: 84, name: 'Guitar - Hard' }, 'Medium': { base: 72, name: 'Guitar - Medium' }, 'Easy': { base: 60, name: 'Guitar - Easy' }
                }
            },
            'PART BASS': {
                name: 'Bass',
                difficulties: {
                    'Expert': { base: 96, name: 'Bass - Expert' }, 'Hard': { base: 84, name: 'Bass - Hard' }, 'Medium': { base: 72, name: 'Bass - Medium' }, 'Easy': { base: 60, name: 'Bass - Easy' }
                }
            }
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
                if (type === 9 && event.data[1] > 0) {
                    activeNotes[event.data[0]] = { tick: currentTick, note: event.data[0] };
                } else if (type === 8 || (type === 9 && event.data[1] === 0)) {
                    const startNote = activeNotes[event.data[0]];
                    if (startNote) {
                        notes.push({ tick: startNote.tick, midiNote: startNote.note, duration: currentTick - startNote.tick });
                        delete activeNotes[event.data[0]];
                    }
                }
            });

            const starPhrases = notes.filter(n => n.midiNote === STAR_POWER_NOTE).map(n => ({ tick: n.tick, type: 'star', duration: n.duration }));

            Object.values(mapping.difficulties).forEach(diff => {
                const difficultyNotes = notes
                    .filter(n => n.midiNote >= diff.base && n.midiNote < diff.base + 5)
                    .map(n => ({
                        tick: n.tick, fret: n.midiNote - diff.base, duration: n.duration, time: ticksToSeconds(n.tick),
                        isStar: starPhrases.some(sp => n.tick >= sp.tick && n.tick < (sp.tick + sp.duration))
                    }));
                
                if (difficultyNotes.length > 0) {
                    notesByTrack[diff.name] = difficultyNotes.sort((a, b) => a.time - b.time);
                    const [instrument, difficulty] = diff.name.split(' - ');
                    availableParts[instrument] = availableParts[instrument] || [];
                    availableParts[instrument].push(difficulty);
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
            '[ExpertSingle]': 'Guitar - Expert', '[HardSingle]': 'Guitar - Hard', '[MediumSingle]': 'Guitar - Medium', '[EasySingle]': 'Guitar - Easy',
            '[ExpertGuitar]': 'Guitar - Expert', '[HardGuitar]': 'Guitar - Hard', '[MediumGuitar]': 'Guitar - Medium', '[EasyGuitar]': 'Guitar - Easy',
            '[ExpertDoubleBass]': 'Bass - Expert', '[HardDoubleBass]': 'Bass - Hard', '[MediumDoubleBass]': 'Bass - Medium', '[EasyDoubleBass]': 'Bass - Easy',
            '[ExpertBass]': 'Bass - Expert', '[HardBass]': 'Bass - Hard', '[MediumBass]': 'Bass - Medium', '[EasyBass]': 'Bass - Easy'
        };

        lines.forEach(line => {
            line = line.trim();
            if (line.startsWith('[') && line.endsWith(']')) {
                currentSection = line;
                if (!notesByTrack[currentSection]) notesByTrack[currentSection] = [];
            } else if (line.includes('=')) {
                const parts = line.split('=').map(s => s.trim());
                const key = parts[0];
                const val = parts[1];
                if (currentSection === '[Song]') {
                    if (key === 'Resolution') resolution = parseFloat(val);
                } else if (currentSection === '[SyncTrack]') {
                    const eventParts = key.split(' ').filter(Boolean);
                    if (eventParts[1] === 'B') {
                        syncTrack.push({ tick: parseInt(eventParts[0]), bpm: parseInt(val) / 1000 });
                    }
                } else if (notesByTrack[currentSection]) {
                     const eventParts = key.split(' ').filter(Boolean);
                     if (eventParts[1] === 'N') {
                        notesByTrack[currentSection].push({
                            tick: parseInt(eventParts[0]), fret: parseInt(eventParts[2]), duration: parseInt(val),
                        });
                     } else if (eventParts[1] === 'S' && eventParts[2] === '2') {
                          notesByTrack[currentSection].push({
                            tick: parseInt(eventParts[0]), type: 'star', duration: parseInt(val),
                        });
                     }
                }
            }
        });

        syncTrack.sort((a,b) => a.tick - b.tick);
        let lastBpm = 120; let lastTick = 0; let timeAtLastBpm = 0;
        syncTrack.forEach(bpmEvent => {
            const ticksSinceLast = bpmEvent.tick - lastTick;
            timeAtLastBpm += (ticksSinceLast / resolution) * (60 / lastBpm);
            bpmEvent.time = timeAtLastBpm;
            lastTick = bpmEvent.tick;
            lastBpm = bpmEvent.bpm;
        });

        const ticksToSeconds = (ticks) => {
            let time = 0; let lastTick = 0; let lastBpm = 120;
            const relevantEvent = [...syncTrack].reverse().find(e => e.tick <= ticks);
            if(relevantEvent){
                 time = relevantEvent.time; lastTick = relevantEvent.tick; lastBpm = relevantEvent.bpm;
            }
            time += ((ticks - lastTick) / resolution) * (60 / lastBpm);
            return time;
        };
        
        Object.keys(partMapping).forEach(section => {
            if(notesByTrack[section]?.length > 0){
                const sectionNotes = notesByTrack[section].filter(n => n.type !== 'star');
                const starPhrases = notesByTrack[section].filter(n => n.type === 'star');
                
                sectionNotes.forEach(note => {
                    note.time = ticksToSeconds(note.tick);
                    note.isStar = starPhrases.some(sp => note.tick >= sp.tick && note.tick < sp.tick + sp.duration);
                });

                notesByTrack[partMapping[section]] = sectionNotes.sort((a,b) => a.time - b.time);
                delete notesByTrack[section];
                const [instrument, difficulty] = partMapping[section].split(' - ');
                availableParts[instrument] = availableParts[instrument] || [];
                availableParts[instrument].push(difficulty);
            }
        });
        
        return { notesByTrack, availableParts };
    }

    // --- UI Rendering ---
    function renderSongList() {
        gameElements.songList.innerHTML = '';
        songs.sort((a, b) => a.name.localeCompare(b.name)).forEach(song => {
            const item = document.createElement('div');
            item.className = 'song-item';
            item.innerHTML = `<b>${song.name}</b><br>${song.artist || 'Unknown Artist'}`;
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
        if (menuMusicPlayer) {
             menuMusicPlayer.stop();
             menuMusicPlayer.dispose();
             menuMusicPlayer = null;
        }
        if(audioPlayers) await audioPlayers.dispose();
        
        activeTrack.notes = JSON.parse(JSON.stringify(currentSongData.notesByTrack[trackKey]));
        activeTrack.totalNotes = activeTrack.notes.length;
        
        gameElements.albumArt.src = currentSongData.albumArtUrl;
        gameElements.songTitle.textContent = currentSongData.name;
        gameElements.songArtist.textContent = currentSongData.artist;
        
        audioPlayers = new Tone.Players(currentSongData.audioUrls, () => {
            Object.values(audioPlayers.players).forEach(p => p.toDestination());
            resetGameState();
            navigateTo('game');
            Tone.Transport.start('+0.5');
            gameLoopId = requestAnimationFrame(gameLoop);
        }).toDestination();
    }
    
    function resetGameState() {
        activeNoteElements = [];
        score = 0; combo = 0; maxCombo = 0; notesHit = 0; multiplier = 1; rockMeter = 50; starPower = 0;
        isStarPowerActive = false;
        gameElements.highway.classList.remove('star-power-active');
        gameElements.noteContainer.innerHTML = '';
        updateUI();
    }

    function gameLoop() {
        if (gameState !== 'playing') {
            cancelAnimationFrame(gameLoopId);
            return;
        }
        const currentTime = Tone.Transport.seconds;
        
        activeTrack.notes.forEach(note => {
            if (!note.spawned && note.time - currentTime < (NOTE_SPEED_MS / 1000)) {
                spawnNote(note);
                note.spawned = true;
            }
        });
        
        for (let i = activeNoteElements.length - 1; i >= 0; i--) {
            const noteData = activeNoteElements[i];
            const timeUntilHit = noteData.time - currentTime;
            
            if (timeUntilHit < -(HIT_WINDOW_MS / 1000) && !noteData.hit && !noteData.missed) {
                missNote(noteData);
                activeNoteElements.splice(i, 1);
            } else {
                const progress = 1 - (timeUntilHit / (NOTE_SPEED_MS / 1000));
                noteData.element.style.transform = `translateY(${progress * 105}vh) translateZ(0)`;
            }
        }
        
        gameLoopId = requestAnimationFrame(gameLoop);
    }
    
    function spawnNote(noteData) {
        const noteEl = document.createElement('div');
        noteEl.className = 'note';
        const gem = document.createElement('div');
        gem.className = 'note-gem';
        noteEl.appendChild(gem);
        
        noteEl.classList.add(FRET_COLORS[noteData.fret]);
        if(noteData.isStar) noteEl.classList.add('star-power');

        noteEl.style.left = `${noteData.fret * 20}%`;
        
        noteData.element = noteEl;
        activeNoteElements.push(noteData);
        gameElements.noteContainer.appendChild(noteEl);
        
        setTimeout(() => { if (noteData.element.parentElement) noteData.element.remove(); }, NOTE_SPEED_MS + 200);
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
                    if(!noteToHit || Math.abs(note.time - currentTime) < Math.abs(noteToHit.time - currentTime)) {
                       noteToHit = note;
                    }
                }
            }
        }
        if (noteToHit) hitNote(noteToHit);
    }
    
    function handleFretRelease(fretIndex) {
         gameElements.frets[fretIndex].classList.remove('active');
    }

    function hitNote(note) {
        note.hit = true;
        note.element.classList.add('hit');
        const index = activeNoteElements.findIndex(n => n === note);
        if(index > -1) activeNoteElements.splice(index, 1);
        
        setTimeout(() => { if(note.element.parentElement) note.element.remove() }, 200);

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
        
        if (rockMeter <= 0) {
            endGame(true);
            return;
        }
        updateUI();
    }
    
    function activateStarPower() {
        if (starPower < 50 || isStarPowerActive || gameState !== 'playing') return;
        isStarPowerActive = true;
        gameElements.highway.classList.add('star-power-active');
        
        const drainInterval = setInterval(() => {
            if (!isStarPowerActive || gameState !== 'playing') {
                isStarPowerActive = false;
                gameElements.highway.classList.remove('star-power-active');
                clearInterval(drainInterval);
                return;
            }
            starPower -= 1;
            if (starPower <= 0) {
                starPower = 0;
                isStarPowerActive = false;
                gameElements.highway.classList.remove('star-power-active');
                clearInterval(drainInterval);
            }
            updateUI();
        }, 80);
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
        gameLoopId = null;
        gameState = 'menu';
        Tone.Transport.stop();
        if (audioPlayers) { audioPlayers.dispose(); audioPlayers = null; }
        
        activeNoteElements.forEach(n => n.element?.remove());
        activeNoteElements = [];

        if (!failed && activeTrack.totalNotes > 0) {
            showResults();
        } else {
            navigateTo('songSelect');
        }
        setTimeout(() => navigateTo('mainMenu'), 100);
        setTimeout(playMenuMusic, 500);
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
        if (gameState === 'playing' && KEY_MAPPING[key] !== undefined) {
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
    });
});
