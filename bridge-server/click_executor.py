import sys
import pyautogui
import time

pyautogui.FAILSAFE = False

COMMANDS = {'type', 'key', 'move', 'drag', 'scroll'}
cmd = sys.argv[1]

if cmd == 'type':
    pyautogui.write(sys.argv[2], interval=0.05)

elif cmd == 'key':
    key = sys.argv[2]
    if '+' in key:
        pyautogui.hotkey(*key.split('+'))
    else:
        pyautogui.press(key)

elif cmd == 'move':
    pyautogui.moveTo(int(sys.argv[2]), int(sys.argv[3]), duration=0.2)

elif cmd == 'drag':
    pyautogui.moveTo(int(sys.argv[2]), int(sys.argv[3]), duration=0.2)
    pyautogui.dragTo(int(sys.argv[4]), int(sys.argv[5]), duration=0.3, button='left')

elif cmd == 'scroll':
    pyautogui.moveTo(int(sys.argv[2]), int(sys.argv[3]), duration=0.1)
    time.sleep(0.05)
    pyautogui.scroll(int(sys.argv[4]))  # positive = up, negative = down

else:
    # click: argv[1]=x  argv[2]=y  argv[3]=button (default left)
    x      = int(sys.argv[1])
    y      = int(sys.argv[2])
    button = sys.argv[3] if len(sys.argv) > 3 else 'left'
    pyautogui.moveTo(x, y, duration=0.3)
    time.sleep(0.1)
    pyautogui.click(button=button)
