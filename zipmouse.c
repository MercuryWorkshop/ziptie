#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <arpa/inet.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <X11/extensions/XTest.h>

#define PORT 12345

#define CMD_KEY 0
#define CMD_MOUSE 1
#define CMD_SCROLL 2

typedef struct {
  int type;
  union {
    struct {
      int x;
      int y;
      int button;
      int action;
    } mouse;
    struct {
      int key;
      int state;
    } key;
    struct {
      int x;
      int y;
    } scroll;
  };
} command_t;

int server_fd = -1, client_fd = -1;

void cleanup(int signum) {
  printf("\nCaught signal %d, cleaning up...\n", signum);
  if (client_fd != -1)
    close(client_fd);
  if (server_fd != -1)
    close(server_fd);
  exit(EXIT_SUCCESS);
}

int main() {
  struct sockaddr_in server_addr, client_addr;
  socklen_t addr_len = sizeof(client_addr);

  signal(SIGINT, cleanup);

  if ((server_fd = socket(AF_INET, SOCK_STREAM, 0)) == -1) {
    perror("socket failed");
    exit(EXIT_FAILURE);
  }

  int opt = 1;
  setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

  server_addr.sin_family = AF_INET;
  server_addr.sin_addr.s_addr = INADDR_ANY;
  server_addr.sin_port = htons(PORT);
  if (bind(server_fd, (struct sockaddr *)&server_addr, sizeof(server_addr)) ==
      -1) {
    perror("bind failed");
    close(server_fd);
    exit(EXIT_FAILURE);
  }

  if (listen(server_fd, 1) == -1) {
    perror("listen failed");
    close(server_fd);
    exit(EXIT_FAILURE);
  }

  printf("Waiting for a connection on port %d...\n", PORT);

  if ((client_fd = accept(server_fd, (struct sockaddr *)&client_addr,
                          &addr_len)) == -1) {
    perror("accept failed");
    close(server_fd);
    exit(EXIT_FAILURE);
  }

  printf("Client connected.\n");
  Display *display = XOpenDisplay(NULL);
  Window root = DefaultRootWindow(display);

  ssize_t bytes_received;
  command_t cmd;
  printf("sizeof cmd: %ld\n", sizeof cmd);

  while ((bytes_received = recv(client_fd, &cmd, sizeof cmd, 0)) > 0) {
    if (bytes_received != sizeof cmd) {
      printf("Received %ld bytes, expected %ld\n", bytes_received, sizeof cmd);
    }

    if (cmd.type == CMD_MOUSE) {
      XWarpPointer(display, None, root, 0, 0, 0, 0, cmd.mouse.x, cmd.mouse.y);
      if (cmd.mouse.button != -1) {
        XTestFakeButtonEvent(display, cmd.mouse.button, cmd.mouse.action, CurrentTime);
      }
      XFlush(display);
    } else if (cmd.type == CMD_KEY) {
      XTestFakeKeyEvent(display, cmd.key.key, cmd.key.state, CurrentTime);
      XFlush(display);
    } else if (cmd.type == CMD_SCROLL) {
      if (cmd.scroll.x == 0) {
        if (cmd.scroll.y > 0) {
          XTestFakeButtonEvent(display,5,1,CurrentTime);
          XTestFakeButtonEvent(display,5,0,CurrentTime);
        } else {
          XTestFakeButtonEvent(display,4,1,CurrentTime);
          XTestFakeButtonEvent(display,4,0,CurrentTime);
        }
      } else {
        if (cmd.scroll.x > 0) {
          XTestFakeButtonEvent(display,6,1,CurrentTime);
          XTestFakeButtonEvent(display,6,0,CurrentTime);
        } else {
          XTestFakeButtonEvent(display,7,1,CurrentTime);
          XTestFakeButtonEvent(display,7,0,CurrentTime);
        }
      }
      


      XFlush(display);
    } else {
      printf("Unknown command type %d\n", cmd.type);
    }
  }

  XCloseDisplay(display);

  if (bytes_received == 0) {
    printf("Client disconnected.\n");
  } else {
    perror("recv failed");
  }

  // Cleanup
  close(client_fd);
  close(server_fd);
  return 0;
}
