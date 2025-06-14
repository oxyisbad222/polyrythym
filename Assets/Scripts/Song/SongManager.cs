using System.Collections.Generic;
using System.IO;
using UnityEngine;

public class SongManager : MonoBehaviour
{
    public static SongManager Instance { get; private set; }

    public List<Song> Songs { get; private set; } = new List<Song>();

    private void Awake()
    {
        // Singleton pattern
        if (Instance == null)
        {
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }
        else
        {
            Destroy(gameObject);
        }
    }

    private void Start()
    {
        // On startup, scan for songs
        ScanForSongs();
    }

    public void ScanForSongs()
    {
        Songs.Clear();
        string songsDirectory = Path.Combine(Application.streamingAssetsPath, "Songs");

        if (!Directory.Exists(songsDirectory))
        {
            Directory.CreateDirectory(songsDirectory);
            Debug.LogWarning("Songs directory not found. Created a new one at: " + songsDirectory);
            return;
        }

        foreach (string songFolder in Directory.GetDirectories(songsDirectory))
        {
            string iniPath = Path.Combine(songFolder, "song.ini");
            if (File.Exists(iniPath))
            {
                Song song = ParseSongIni(iniPath, songFolder);
                if (song != null)
                {
                    Songs.Add(song);
                }
            }
        }
    }

    private Song ParseSongIni(string iniPath, string songFolder)
    {
        try
        {
            Song song = new Song();
            song.DirectoryPath = songFolder;

            string[] lines = File.ReadAllLines(iniPath);
            Dictionary<string, string> iniData = new Dictionary<string, string>();

            foreach (string line in lines)
            {
                if (line.Contains("="))
                {
                    string[] parts = line.Split(new char[] { '=' }, 2);
                    iniData[parts[0].Trim()] = parts[1].Trim();
                }
            }

            // Extract metadata from the ini file
            song.Name = iniData.GetValueOrDefault("name", "Unknown Song");
            song.Artist = iniData.GetValueOrDefault("artist", "Unknown Artist");
            song.Album = iniData.GetValueOrDefault("album", "Unknown Album");
            song.Charter = iniData.GetValueOrDefault("charter", "Unknown Charter");
            song.MusicStreamVolume = float.Parse(iniData.GetValueOrDefault("music_stream_volume", "0.0"));


            // Find the file paths
            song.AlbumArtPath = Path.Combine(songFolder, "album.jpg");
            song.MidiPath = Path.Combine(songFolder, "notes.mid");
            song.OpusTrackPaths = Directory.GetFiles(songFolder, "*.opus");
            
            // Basic validation
            if (string.IsNullOrEmpty(song.MidiPath) || song.OpusTrackPaths.Length == 0)
            {
                Debug.LogWarning($"Song at '{songFolder}' is missing notes.mid or .opus files. Skipping.");
                return null;
            }

            return song;
        }
        catch (System.Exception ex)
        {
            Debug.LogError($"Failed to parse song.ini at '{iniPath}': {ex.Message}");
            return null;
        }
    }
}
