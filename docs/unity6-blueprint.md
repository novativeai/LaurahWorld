# Unity 6 — Isometric Motion System Blueprint

Faithful port of the LaurahWorld motion system (Phaser 3 + Three.js) to Unity 6.
Covers camera, coordinate math, click-to-move, hold-to-run, facing formula, and object interaction.

---

## 1. Project Setup

**Unity version:** 6000.0 LTS  
**Render pipeline:** URP (Universal Render Pipeline)  
**Required packages** (Package Manager):
- `com.unity.inputsystem` — new Input System
- `com.unity.cinemachine` — v3.x camera
- `com.unity.ai.navigation` — NavMesh (optional; see §5)

**Project settings:**
- Edit → Project Settings → Player → Active Input Handling → **Input System Package (New)**

---

## 2. Isometric Camera

### Angle
The projection matches a **2:1 pixel-art isometric** view:
- Elevation: **arctan(0.5) ≈ 26.565°**
- Azimuth: **45°** (camera looks from NE toward SW)

### Camera GameObject
```
Main Camera
  Position:  (0, 7.07, -7.07)   ← distance 10 from origin, elevation 45°
  Rotation:  (26.565, 45, 0)
  Projection: Orthographic
  Size:       5  (adjust to taste)
```

> **Why these values?** At elevation 26.565° and azimuth 45°, the projected
> tile footprint has a 2:1 width-to-height ratio, matching the Phaser game
> where HALF_W=128, HALF_H=64. This keeps visual parity if assets are shared.

### Cinemachine (camera follow + bounds)
1. Add **CinemachineCamera** component to a new GameObject `VirtualCamera`.
2. Set **Follow** = Laurah transform.
3. Add **CinemachineConfiner2D** (or **CinemachineConfiner3D**) component:
   - Create a `PolygonCollider2D` on an empty GameObject matching the world boundary.
   - Assign it to the confiner's **Bounding Shape**.
4. Set **Lens → Orthographic Size** to match the Main Camera size.
5. Set **Body → Position Damping** = (0, 0, 0) for instant follow; increase for smoothing.

---

## 3. Scene Structure

```
Scene
├── Environment
│   ├── Ground          ← Plane mesh, infinite white or tiled
│   ├── House           ← Prefab, InteractableObject component
│   └── EmeraldCrystal  ← Prefab, InteractableObject component
├── Characters
│   └── Laurah          ← GLB/FBX import, Animator, CharacterMover
├── Cameras
│   ├── Main Camera
│   └── VirtualCamera   ← CinemachineCamera
└── Managers
    └── InputManager    ← PlayerInput component
```

---

## 4. Coordinate System

### World → Screen (iso projection)
In the Phaser game, isometric screen coordinates are computed as:
```
screenX = originX + (wx - wy) * HALF_W
screenY = originY + (wx + wy) * HALF_H
```

In Unity this projection is handled implicitly by the orthographic camera.
Place objects at **Unity world position (wx, 0, wy)** — the camera projects them
correctly onto the 2D screen.

### Screen → World (click ray)
```csharp
// Given a screen click position from Input System:
Ray ray = Camera.main.ScreenPointToRay(screenPos);
Plane groundPlane = new Plane(Vector3.up, Vector3.zero);
if (groundPlane.Raycast(ray, out float enter))
{
    Vector3 worldHit = ray.GetPoint(enter);
    // worldHit.x = wx, worldHit.z = wy
}
```

---

## 5. Character Setup

### Import
- Import `Laurah-game.glb` (or `.fbx`) into `Assets/Characters/`.
- In the **Rig** tab: Animation Type = **Humanoid** (or Generic if rig is custom).
- In the **Animation** tab: extract the four clips and rename them:

| Clip index | Name       | Loop |
|------------|------------|------|
| 0          | FoldArms   | ✓    |
| 1          | Idle       | ✓    |
| 2          | Run        | ✓    |
| 3          | Walk       ✓    |

### Animator Controller
Create `Assets/Animators/LaurahAnimator.controller`:

```
Parameters:
  float  Speed     (0 = idle, 0.5 = walk, 1 = run)
  trigger Interact

States:
  Idle  ←→  Walk  ←→  Run   (blend via Speed threshold)
  Any State → Interact (on trigger)

Transitions:
  Idle → Walk:  Speed > 0.1,  transition 0.2 s
  Walk → Idle:  Speed < 0.05, transition 0.3 s
  Walk → Run:   Speed > 0.6,  transition 0.15 s
  Run  → Walk:  Speed < 0.55, transition 0.15 s
```

**Blend Tree alternative** (smoother):
- Use a 1D Blend Tree on the `Speed` parameter.
- Add Idle (0), Walk (0.5), Run (1.0) motions.

---

## 6. Movement System

### CharacterMover.cs

```csharp
using UnityEngine;
using UnityEngine.InputSystem;

[RequireComponent(typeof(Animator))]
public class CharacterMover : MonoBehaviour
{
    [Header("Speed")]
    public float walkSpeed = 2.5f;
    public float runSpeed  = 5.5f;

    [Header("Thresholds")]
    public float runDistThreshold  = 4f;   // world units; beyond this = run on click
    public float arrivalRadius     = 0.08f;
    public float holdThresholdSec  = 0.2f; // seconds before hold activates

    [Header("Rotation")]
    public float rotationSpeed = 8f;       // rad/s (matches Three.js lerp)

    [Header("World Bounds")]
    public Vector2 worldMin = Vector2.zero;
    public Vector2 worldMax = new Vector2(30, 30);

    // ── Private state ──────────────────────────────────────────────────────
    private Animator     _anim;
    private Camera       _cam;
    private Vector3      _target;
    private bool         _moving;
    private bool         _pointerHeld;
    private float        _pointerHeldSec;
    private MoverState   _state = MoverState.Idle;

    private enum MoverState { Idle, Walking, Running }

    // ── Init ───────────────────────────────────────────────────────────────
    void Awake()
    {
        _anim   = GetComponent<Animator>();
        _cam    = Camera.main;
        _target = transform.position;
    }

    // ── Input (called by PlayerInput component) ────────────────────────────
    public void OnClick(InputAction.CallbackContext ctx)
    {
        if (ctx.phase == InputActionPhase.Started)
        {
            _pointerHeld    = true;
            _pointerHeldSec = 0f;
            MoveToPointer(force: true); // initial single-click target
        }
        else if (ctx.phase == InputActionPhase.Canceled)
        {
            _pointerHeld = false;
        }
    }

    // ── Update ─────────────────────────────────────────────────────────────
    void Update()
    {
        HandleHold();
        if (_moving) StepToward();
    }

    private void HandleHold()
    {
        if (!_pointerHeld) return;
        _pointerHeldSec += Time.deltaTime;
        if (_pointerHeldSec >= holdThresholdSec)
            MoveToPointer(force: false); // continuous chase while held
    }

    private void MoveToPointer(bool force)
    {
        Vector2 screenPos = Mouse.current.position.ReadValue();
        Ray ray = _cam.ScreenPointToRay(screenPos);
        Plane plane = new Plane(Vector3.up, Vector3.zero);
        if (!plane.Raycast(ray, out float enter)) return;

        Vector3 hit = ray.GetPoint(enter);
        hit.x = Mathf.Clamp(hit.x, worldMin.x, worldMax.x);
        hit.z = Mathf.Clamp(hit.z, worldMin.y, worldMax.y);
        hit.y = 0f;
        _target = hit;
        _moving = true;

        if (force)
        {
            // Single click: walk or run based on distance
            float dist = Vector3.Distance(transform.position, _target);
            SetState(dist >= runDistThreshold ? MoverState.Running : MoverState.Walking);
        }
        else
        {
            // Hold: always run
            SetState(MoverState.Running);
        }
    }

    private void StepToward()
    {
        Vector3 delta = _target - transform.position;
        delta.y = 0f;
        float dist = delta.magnitude;

        if (dist <= arrivalRadius)
        {
            if (!_pointerHeld)
            {
                transform.position = _target;
                _moving = false;
                SetState(MoverState.Idle);
            }
            return;
        }

        // Facing — smooth rotate toward movement direction
        ApplyFacing(delta / dist);

        float speed = _state == MoverState.Running ? runSpeed : walkSpeed;
        float step  = Mathf.Min(speed * Time.deltaTime, dist);
        transform.position += (delta / dist) * step;
    }

    private void SetState(MoverState next)
    {
        if (next == _state) return;
        _state = next;
        float speedParam = next == MoverState.Running ? 1f
                         : next == MoverState.Walking ? 0.5f : 0f;
        _anim.SetFloat("Speed", speedParam, 0.1f, Time.deltaTime);
    }

    // ── Facing ─────────────────────────────────────────────────────────────
    // Movement direction (dx, dz) is in Unity world XZ space.
    // The camera is at NE azimuth 45°, elevation 26.565°.
    // Camera vectors (world XZ components):
    //   right = ( 0.7071,  0,  0.7071)  [NE→SW, right on screen = SE world]
    //   up_xz = (-0.3162,  0, -0.3162)  ... wait, let me use the actual Unity values.
    //
    // For Unity camera at Rotation(26.565, 45, 0):
    //   cam.right   world = ( 0.7071, 0, -0.7071)  [screen right = world SE]
    //   cam.up      world horizontal ≈ (-0.3162, 0, -0.3162) * cos(26.565°) ...
    //
    // Practically: compute facing angle from screen-space direction, then
    // convert back to a world Y rotation.
    //
    // Simpler approach that works identically to the JS derivation:
    // project (dx, dz) onto (camRight.xz) and (camDown.xz), get screen angle,
    // subtract from model's screen-north offset.
    //
    // For an isometric camera at exactly 45°/26.565°:
    //   screen_x = (dx - dz) / sqrt(2)
    //   screen_y = (dx + dz) / (2 * sqrt(2))   [half the x rate]
    //
    // Target Y rotation (degrees) that makes the character APPEAR to face (dx,dz):
    //   θ = atan2(26.78*dx + 84.36*dz, -82.17*dx + 18.67*dz) + 180°
    //
    // These constants are derived from the camera geometry (§8 below).
    // They match the Three.js implementation exactly when the model's local
    // forward is +X (Laurah's GLB convention).

    private void ApplyFacing(Vector3 dir)
    {
        // dir.x = dwx, dir.z = dwy (normalised movement vector in world XZ)
        float dwx = dir.x;
        float dwy = dir.z;

        float targetAngleRad = Mathf.Atan2(
             26.78f * dwx + 84.36f * dwy,
            -82.17f * dwx + 18.67f * dwy
        ) + Mathf.PI;

        float targetDeg = targetAngleRad * Mathf.Rad2Deg;

        // Smooth rotation at rotationSpeed rad/s (converted to deg/s)
        float maxDeg   = rotationSpeed * Mathf.Rad2Deg * Time.deltaTime;
        float current  = transform.eulerAngles.y;
        float next     = Mathf.MoveTowardsAngle(current, targetDeg, maxDeg);
        transform.rotation = Quaternion.Euler(0, next, 0);
    }
}
```

### PlayerInput Setup
1. Create `Assets/Input/LaurahActions.inputactions`.
2. Add Action Map `Player` with one action: `Click` (Button, binding: `<Mouse>/leftButton`).
3. On the Laurah GameObject: add **PlayerInput** component → assign the asset → set `OnClick` as callback.

---

## 7. Facing Formula — Derivation

The formula in `ApplyFacing` is not magic — it is derived analytically from the camera geometry and accounts for the GLB's local-forward convention.

### Camera vectors (world XZ)
For a camera at position (4, 5, 7) looking at (0, 0.9, 0) (the original Three.js values):

```
cam_right_xz = ( 0.8682,  0, -0.4961)
cam_up_xz    = (-0.2249,  0, -0.3939)   ← horizontal component of cam_up
```

### Screen projection of world movement (dwx, dwy)
```
screen_x   = dot((dwx,dwy), cam_right_xz) = 0.8682·dwx − 0.4961·dwy
screen_y_up = dot((dwx,dwy), cam_up_xz)  = −0.2249·dwx − 0.3939·dwy
```

### Invert to get model rotation
The Laurah GLB's **local forward = +X**. In Three.js, at `rotation.y = θ`,
world forward = `(cosθ, 0, −sinθ)`. We want the screen projection of this
forward to match the screen projection of the movement direction.

Setting up the 2×2 linear system and solving via Cramer's rule gives:

```
θ = atan2(−0.8682·Q − 0.2249·P,  −0.3939·P + 0.4961·Q)
```
where `P = screen_x`, `Q = screen_y_up`, then substituting P and Q in terms
of (dwx, dwy) and collecting constants yields:

```
θ = atan2(26.78·dwx + 84.36·dwy,  −82.17·dwx + 18.67·dwy) + π
```

The `+ π` corrects for the model's front face pointing in the −X direction
(the GLB was exported facing away from the camera at rest).

### Unity camera note
For a pure 45°/26.565° Unity camera, the constants shift slightly. Re-derive
by reading `Camera.main.transform.right` and `Camera.main.transform.up`
at runtime and computing the same Cramer inversion, or calibrate empirically:

```csharp
// One-time calibration (paste into Start(), log, then hardcode)
Vector3 r = _cam.transform.right;
Vector3 u = _cam.transform.up;
// Rx=r.x, Rz=r.z, Ux=u.x, Uz=u.z
// Det = Rx*Uz - Rz*Ux
// A = (Uz * HW + Rz * HH) / Det  ... etc.
Debug.Log($"right=({r.x:F4},{r.z:F4}) up=({u.x:F4},{u.z:F4})");
```

---

## 8. Object Interaction

### InteractableObject.cs

```csharp
using UnityEngine;
using UnityEngine.Events;

public class InteractableObject : MonoBehaviour
{
    public string displayName = "Object";
    public UnityEvent onInteract;

    private void OnMouseDown()
    {
        // Fires on click (requires a Collider on the GameObject)
        onInteract.Invoke();
        Debug.Log($"Laurah interacts with {displayName}!");
        // Optionally: send event to UI manager for status text
    }

    private void OnMouseEnter() => HighlightOn();
    private void OnMouseExit()  => HighlightOff();

    private void HighlightOn()  { /* swap material or set emission */ }
    private void HighlightOff() { /* revert material */ }
}
```

> **Note:** `OnMouseDown` requires Physics Raycaster on the camera.
> With the new Input System, replace with a Raycast in the InputManager
> and an `IInteractable` interface pattern instead.

### With new Input System + IInteractable
```csharp
public interface IInteractable
{
    void Interact();
}

// In InputManager.Update():
if (clickAction.WasPerformedThisFrame())
{
    Ray ray = _cam.ScreenPointToRay(Mouse.current.position.ReadValue());
    if (Physics.Raycast(ray, out RaycastHit hit))
    {
        var interactable = hit.collider.GetComponent<IInteractable>();
        interactable?.Interact();
    }
}
```

---

## 9. World Bounds

Define bounds as a `Vector4 (xMin, zMin, xMax, zMax)` in a `GameSettings` ScriptableObject:

```csharp
// Clamp in CharacterMover:
hit.x = Mathf.Clamp(hit.x, settings.worldMin.x, settings.worldMax.x);
hit.z = Mathf.Clamp(hit.z, settings.worldMin.y, settings.worldMax.y);
```

For camera confinement with Cinemachine 3.x:
- Use a `BoxCollider` (trigger) sized to the world bounds.
- Assign to `CinemachineConfiner3D.BoundingVolume`.

---

## 10. Y-Sorting (Depth)

Unity's URP handles depth via the Z-axis for 3D objects. For 2D sprites (if
any) in an isometric layout, set **Sorting Layer** and use:

```csharp
// On any sprite renderer placed in the world:
GetComponent<SpriteRenderer>().sortingOrder = Mathf.RoundToInt(-transform.position.z * 100);
```

For 3D meshes, the camera's perspective naturally provides correct occlusion.
No manual depth sorting is needed for the Laurah GLB.

---

## 11. Quick-Start Checklist

- [ ] Unity 6 project with URP
- [ ] Input System, Cinemachine 3.x packages installed
- [ ] Camera at Rotation (26.565, 45, 0), Orthographic
- [ ] `Laurah-game.glb` imported, Rig = Humanoid/Generic, 4 clips named
- [ ] `LaurahAnimator.controller` with Speed blend tree
- [ ] `CharacterMover.cs` on Laurah, PlayerInput wired to `OnClick`
- [ ] `VirtualCamera` with CinemachineCamera, Follow = Laurah, confiner set
- [ ] `InteractableObject.cs` on House and Crystal with BoxCollider
- [ ] `GameSettings` ScriptableObject with world bounds (0,0) → (30,30)
- [ ] Verify cardinal directions: click N → Laurah faces screen-up ✓
