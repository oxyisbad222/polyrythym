using UnityEngine;
using UnityEngine.SceneManagement;

public class GameManager : MonoBehaviour
{
    public static GameManager Instance { get; private set; }

    public enum GameState
    {
        MainMenu,
        Gameplay,
        Results
    }

    public GameState CurrentState { get; private set; }

    private void Awake()
    {
        // Singleton pattern to ensure only one instance of the GameManager exists
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
        // Set the initial game state
        CurrentState = GameState.MainMenu;
    }

    public void StartGame()
    {
        // Load the gameplay scene and set the state to Gameplay
        CurrentState = GameState.Gameplay;
        SceneManager.LoadScene("Gameplay");
    }

    public void EndGame()
    {
        // Load the results scene and set the state to Results
        CurrentState = GameState.Results;
        SceneManager.LoadScene("Results");
    }

    public void GoToMainMenu()
    {
        // Load the main menu scene and set the state to MainMenu
        CurrentState = GameState.MainMenu;
        SceneManager.LoadScene("MainMenu");
    }
}
