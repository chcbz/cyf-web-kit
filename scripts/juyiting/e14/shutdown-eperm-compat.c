#define _GNU_SOURCE
#include <sys/socket.h>
#include <errno.h>
#include <dlfcn.h>
#include <stdatomic.h>
#include <unistd.h>

#define MAX_TRACKED_FD 65536
#define SOCKET_TYPE_MASK 0xf

typedef int (*socketpair_fn)(int, int, int, int[2]);
typedef int (*shutdown_fn)(int, int);
typedef int (*close_fn)(int);

static _Atomic unsigned char unix_socketpair_fds[MAX_TRACKED_FD];

static int tracked_fd(int fd) {
  return fd >= 0 && fd < MAX_TRACKED_FD
    && atomic_load_explicit(&unix_socketpair_fds[fd], memory_order_relaxed) != 0;
}

/* Track only AF_UNIX socket pairs created through libc in this Chromium process. */
int socketpair(int domain, int type, int protocol, int pair[2]) {
  static socketpair_fn real_socketpair = 0;
  if (!real_socketpair) real_socketpair = (socketpair_fn)dlsym(RTLD_NEXT, "socketpair");
  if (!real_socketpair) { errno = ENOSYS; return -1; }
  int result = real_socketpair(domain, type, protocol, pair);
  if (result == 0 && domain == AF_UNIX) {
    const int base_type = type & SOCKET_TYPE_MASK;
    if (base_type == SOCK_STREAM || base_type == SOCK_SEQPACKET) {
      if (pair[0] >= 0 && pair[0] < MAX_TRACKED_FD) {
        atomic_store_explicit(&unix_socketpair_fds[pair[0]], 1, memory_order_relaxed);
      }
      if (pair[1] >= 0 && pair[1] < MAX_TRACKED_FD) {
        atomic_store_explicit(&unix_socketpair_fds[pair[1]], 1, memory_order_relaxed);
      }
    }
  }
  return result;
}

/* Preserve libc semantics except for Seccomp EPERM on a tracked Unix socketpair fd. */
int shutdown(int fd, int how) {
  static shutdown_fn real_shutdown = 0;
  if (!real_shutdown) real_shutdown = (shutdown_fn)dlsym(RTLD_NEXT, "shutdown");
  if (!real_shutdown) { errno = ENOSYS; return -1; }
  int result = real_shutdown(fd, how);
  if (result == -1 && errno == EPERM && tracked_fd(fd)
      && (how == SHUT_RD || how == SHUT_WR || how == SHUT_RDWR)) {
    return 0;
  }
  return result;
}

/* Prevent a reused descriptor from inheriting a stale socketpair marker. */
int close(int fd) {
  static close_fn real_close = 0;
  if (!real_close) real_close = (close_fn)dlsym(RTLD_NEXT, "close");
  if (!real_close) { errno = ENOSYS; return -1; }
  if (fd >= 0 && fd < MAX_TRACKED_FD) {
    atomic_store_explicit(&unix_socketpair_fds[fd], 0, memory_order_relaxed);
  }
  return real_close(fd);
}
