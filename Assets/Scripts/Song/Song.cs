using UnityEngine;

[System.Serializable]
public class Song
{
    public string Name { get; set; }
    public string Artist { get; set; }
    public string Album { get; set; }
    public string Charter { get; set; }
    public float MusicStreamVolume { get; set; }

    public string DirectoryPath { get; set; }
    public string AlbumArtPath { get; set; }
    public string MidiPath { get; set; }
    public string[] OpusTrackPaths { get; set; }

    public Texture2D AlbumArt { get; set; }
}
