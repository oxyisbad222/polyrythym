document.addEventListener('DOMContentLoaded', () => {
    const mainMenu = document.getElementById('main-menu');
    const gameContainer = document.getElementById('game-container');
    const songList = document.getElementById('song-list');
    const songFolderInput = document.getElementById('song-folder-input');
    const albumArt = document.getElementById('album-art');
    const noteContainer = document.getElementById('note-container');
    const fretboard = document.getElementById('fretboard');
    const frets = document.querySelectorAll('.fret');

    let songs = [];
    let currentSong = null;
    let audio = null;
    let notes = [];
    let gameInterval = null;

    const keyMap = {
        'a': 0,
        's': 1,
        'd': 2,
        'j': 3,
        'k': 4,
        'l': 5
    };

    const fretColors = [
        '#FF5733', '#FFC300', '#DAF7A6',
        '#33FF57', '#33D4FF', '#C70039'
    ];

    songFolderInput.addEventListener('change', (event) => {
        const files = event.target.files;
        const songFolders = {};

        for (const file of files) {
            const pathParts = file.webkitRelativePath.split('/');
            const songFolderName = pathParts[0];

            if (!songFolders[songFolderName]) {
                songFolders[songFolderName] = {
                    album: null,
                    track: null,
                    notes: null,
                    ini: null,
                    name: songFolderName
                };
            }

            if (file.name.toLowerCase().endsWith('.jpg')) {
                songFolders[songFolderName].album = URL.createObjectURL(file);
            } else if (file.name.toLowerCase().endsWith('.opus')) {
                songFolders[songFolderName].track = URL.createObjectURL(file);
            } else if (file.name.toLowerCase().endsWith('.mid')) {
                // For simplicity, we'll use a placeholder for midi parsing.
                // A real implementation would require a MIDI parsing library.
                songFolders[songFolderName].notes = [{ time: 1000, fret: 0 }, { time: 2000, fret: 1 }];
            } else if (file.name.toLowerCase().endsWith('.ini')) {
                 // A real implementation would parse this file.
            }
        }

        songs = Object.values(songFolders);
        renderSongList();
    });

    function renderSongList() {
        songList.innerHTML = '';
        songs.forEach((song, index) => {
            const songItem = document.createElement('div');
            songItem.classList.add('song-item');
            songItem.textContent = song.name;
            songItem.addEventListener('click', () => {
                startGame(song);
            });
            songList.appendChild(songItem);
        });
    }

    function startGame(song) {
        currentSong = song;
        mainMenu.style.display = 'none';
        gameContainer.style.display = 'flex';

        if (song.album) {
            albumArt.style.backgroundImage = `url(${song.album})`;
        }

        notes = song.notes;
        audio = new Audio(song.track);

        audio.addEventListener('canplaythrough', () => {
            audio.play();
            gameInterval = setInterval(gameLoop, 16); // Approx 60 FPS
        });
    }

    function gameLoop() {
        const currentTime = audio.currentTime * 1000; // Convert to milliseconds

        // Note spawning
        notes.forEach(note => {
            if (note.time >= currentTime && note.time < currentTime + 2000 && !note.spawned) {
                spawnNote(note);
                note.spawned = true;
            }
        });

        // Move existing notes
        const existingNotes = document.querySelectorAll('.note');
        existingNotes.forEach(noteEl => {
            const currentTop = parseFloat(noteEl.style.top);
            noteEl.style.top = (currentTop + 5) + 'px'; // Adjust speed as needed

            if (currentTop > noteContainer.clientHeight) {
                noteEl.remove();
            }
        });
    }

    function spawnNote(note) {
        const noteEl = document.createElement('div');
        noteEl.classList.add('note');
        noteEl.style.left = `${(note.fret / 6) * 100}%`;
        noteEl.style.top = '0px';
        noteEl.style.backgroundColor = fretColors[note.fret];
        noteContainer.appendChild(noteEl);
    }

    function handleKeyPress(key) {
        const fretIndex = keyMap[key];
        if (fretIndex !== undefined) {
            frets[fretIndex].classList.add('active');
            setTimeout(() => {
                frets[fretIndex].classList.remove('active');
            }, 100);
            checkNoteHit(fretIndex);
        }
    }

    function checkNoteHit(fretIndex) {
        const existingNotes = document.querySelectorAll('.note');
        existingNotes.forEach(noteEl => {
            const noteFret = Math.round((parseFloat(noteEl.style.left) / 100) * 6);
            const noteTop = parseFloat(noteEl.style.top);
            const hitZone = noteContainer.clientHeight - 50;

            if (noteFret === fretIndex && noteTop > hitZone && noteTop < noteContainer.clientHeight) {
                noteEl.remove();
                // Add scoring logic here
            }
        });
    }

    // Keyboard controls
    window.addEventListener('keydown', (event) => {
        handleKeyPress(event.key.toLowerCase());
    });

    // Touch controls
    frets.forEach((fret, index) => {
        fret.addEventListener('touchstart', (event) => {
            event.preventDefault(); // Prevent double-tap zoom
            fret.classList.add('active');
            checkNoteHit(index);
        });

        fret.addEventListener('touchend', () => {
            fret.classList.remove('active');
        });
    });
});
