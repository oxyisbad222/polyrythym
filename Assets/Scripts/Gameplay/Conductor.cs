using UnityEngine;

public class Conductor : MonoBehaviour
{
    public static Conductor Instance { get; private set; }

    public float songBpm;
    public float secPerBeat;
    public float songPosition;
    public float songPositionInBeats;
    public float dspSongTime;

    public AudioSource musicSource;

    private void Awake()
    {
        // Singleton pattern
        if (Instance == null)
        {
            Instance = this;
        }
        else
        {
            Destroy(gameObject);
        }
    }

    void Start()
    {
        // Example BPM, this will be loaded from the song.ini later
        songBpm = 120f; 

        // Calculate the number of seconds in each beat
        secPerBeat = 60f / songBpm;

        // Record the time when the song starts
        dspSongTime = (float)AudioSettings.dspTime;

        // Start the music
        musicSource.Play();
    }

    void Update()
    {
        // determine how many seconds since the song started
        songPosition = (float)(AudioSettings.dspTime - dspSongTime);

        // determine how many beats since the song started
        songPositionInBeats = songPosition / secPerBeat;
    }
}
