using UnityEngine;

public class PlayerController : MonoBehaviour
{
    public static PlayerController Instance { get; private set; }

    // --- Player Stats ---
    public int score;
    public int combo;
    public int multiplier;
    
    // We can add more stats like health, energy for star power, etc. later.

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

    private void Start()
    {
        // Initialize player stats at the beginning of a song
        ResetStats();
    }

    public void ResetStats()
    {
        score = 0;
        combo = 0;
        multiplier = 1;
    }

    /// <summary>
    /// Called when the player successfully hits a note.
    /// </summary>
    public void NoteHit()
    {
        combo++;
        UpdateMultiplier();
        score += 100 * multiplier; // Example scoring
        
        // Update UI elements here (we will create the UI script later)
        // UIManager.Instance.UpdateScore(score);
        // UIManager.Instance.UpdateCombo(combo);
        // UIManager.Instance.UpdateMultiplier(multiplier);
    }

    /// <summary>
    /// Called when the player misses a note.
    /// </summary>
    public void NoteMiss()
    {
        combo = 0;
        multiplier = 1;

        // Update UI elements here (we will create the UI script later)
        // UIManager.Instance.UpdateCombo(combo);
        // UIManager.Instance.UpdateMultiplier(multiplier);
    }

    /// <summary>
    /// Updates the score multiplier based on the current combo.
    /// </summary>
    private void UpdateMultiplier()
    {
        if (combo >= 30)
        {
            multiplier = 4;
        }
        else if (combo >= 20)
        {
            multiplier = 3;
        }
        else if (combo >= 10)
        {
            multiplier = 2;
        }
        else
        {
            multiplier = 1;
        }
    }
}
