using UnityEngine;

public class InputManager : MonoBehaviour
{
    public static InputManager Instance { get; private set; }

    // An array to hold the state of each of the 6 keys.
    public bool[] keys = new bool[6];

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

    private void Update()
    {
        // Reset keys array on each frame
        for (int i = 0; i < keys.Length; i++)
        {
            keys[i] = false;
        }

        // --- Keyboard Input (for Web and Editor) ---
        if (Input.GetKey(KeyCode.A)) keys[0] = true;
        if (Input.GetKey(KeyCode.S)) keys[1] = true;
        if (Input.GetKey(KeyCode.D)) keys[2] = true;
        if (Input.GetKey(KeyCode.J)) keys[3] = true;
        if (Input.GetKey(KeyCode.K)) keys[4] = true;
        if (Input.GetKey(KeyCode.L)) keys[5] = true;

        // --- Touch Input (for Mobile) ---
        if (Input.touchCount > 0)
        {
            foreach (Touch touch in Input.touches)
            {
                // Determine which column the touch is in
                int column = (int)(touch.position.x / (Screen.width / 6f));

                // Ensure the column is within bounds
                if (column >= 0 && column < 6)
                {
                    keys[column] = true;
                }
            }
        }
    }

    // --- Public methods to check key state ---

    public bool GetKey(int keyIndex)
    {
        if (keyIndex >= 0 && keyIndex < keys.Length)
        {
            return keys[keyIndex];
        }
        return false;
    }
}
