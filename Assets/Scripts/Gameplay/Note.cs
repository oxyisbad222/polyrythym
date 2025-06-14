[System.Serializable]
public class Note
{
    public int lane;         // The lane (0-5) the note belongs to.
    public float time;       // The time in seconds when the note should be hit.
    public float length;     // The length of the note in seconds (0 for a standard note).
    public bool isSustain;   // Is this part of a sustain note?

    public Note(int lane, float time, float length = 0)
    {
        this.lane = lane;
        this.time = time;
        this.length = length;
        this.isSustain = length > 0;
    }
}
