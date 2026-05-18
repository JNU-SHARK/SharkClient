/* config.h - Generated for static build via cc crate */
#ifndef LIBDE265_CONFIG_H
#define LIBDE265_CONFIG_H

#define LIBDE265_STATIC_BUILD 1

#define HAVE_STDINT_H 1
#define HAVE_STDBOOL_H 1

#ifdef _MSC_VER
  #define HAVE_MALLOC_H 1
#else
  #define HAVE_ALLOCA_H 1
#endif

/* SSE acceleration on x86/x64 */
#if defined(__x86_64__) || defined(_M_X64) || defined(__i386__) || defined(_M_IX86)
  #define HAVE_SSE4_1 1
#endif

#endif
