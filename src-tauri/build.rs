fn main() {
    tauri_build::build();

    // === Compile libde265 H.265 decoder from vendored C++ source ===
    let mut build = cc::Build::new();

    build
        .cpp(true)
        // Include paths: "vendor/" so `#include "libde265/de265.h"` works,
        // and "vendor/libde265/" so `#include "de265.h"` also works.
        .include("vendor")
        .include("vendor/libde265")
        .define("LIBDE265_STATIC_BUILD", None)
        .define("HAVE_CONFIG_H", "1")
        .define("HAVE_STDINT_H", "1")
        .define("HAVE_STDBOOL_H", "1")
        .opt_level(3) // max perf for decode hot path
        .std("c++14")
        .flag_if_supported("-w") // GCC/Clang: suppress warnings
        .flag_if_supported("/w"); // MSVC: suppress warnings

    // Platform-specific config
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();

    if target_os == "windows" {
        build.define("_CRT_SECURE_NO_WARNINGS", None);
        build.define("NOMINMAX", None);
        // Add win32cond.c for Windows threading support
        build.file("vendor/extra/win32cond.c");
        if target_env == "msvc" {
            build.flag("/EHsc"); // C++ exception handling

            // Ensure UCRT and Windows SDK include paths are available.
            // The cc crate may not always find these automatically.
            if let Some(ucrt_include) = find_windows_sdk_ucrt_include() {
                build.include(&ucrt_include);
            }
            if let Some(um_include) = find_windows_sdk_um_include() {
                build.include(&um_include);
            }
            if let Some(shared_include) = find_windows_sdk_shared_include() {
                build.include(&shared_include);
            }
            if let Some(msvc_include) = find_msvc_include() {
                build.include(&msvc_include);
            }
        }
    } else if target_os == "linux" {
        // Prefer the portable POSIX allocator path in vendored libde265.
        // Without this, image.cc falls back to memalign(), which is not
        // declared unless the right libc feature macros are visible.
        build.define("HAVE_POSIX_MEMALIGN", "1");
        build.define("HAVE_MALLOC_H", "1");
    }

    // SSE4.1 acceleration on x86/x64
    let is_x86 = target_arch == "x86_64" || target_arch == "x86";
    if is_x86 {
        build.define("HAVE_SSE4_1", "1");
        if target_env == "msvc" {
            // MSVC enables SSE4.1 by default on x64, no flag needed
        } else {
            build.flag("-msse4.1");
        }
    }

    // Core decoder source files (exclude en265.cc encoder)
    let core_sources = [
        "alloc_pool.cc",
        "bitstream.cc",
        "cabac.cc",
        "configparam.cc",
        "contextmodel.cc",
        "de265.cc",
        "deblock.cc",
        "decctx.cc",
        "dpb.cc",
        "fallback-dct.cc",
        "fallback-motion.cc",
        "fallback.cc",
        "image-io.cc",
        "image.cc",
        "intrapred.cc",
        "md5.cc",
        "motion.cc",
        "nal-parser.cc",
        "nal.cc",
        "pps.cc",
        "quality.cc",
        "refpic.cc",
        "sao.cc",
        "scan.cc",
        "sei.cc",
        "slice.cc",
        "sps.cc",
        "threads.cc",
        "transform.cc",
        "util.cc",
        "visualize.cc",
        "vps.cc",
        "vui.cc",
    ];

    for src in &core_sources {
        build.file(format!("vendor/libde265/{}", src));
    }

    // x86 SSE acceleration sources
    if is_x86 {
        let sse_sources = ["x86/sse.cc", "x86/sse-dct.cc", "x86/sse-motion.cc"];
        for src in &sse_sources {
            build.file(format!("vendor/libde265/{}", src));
        }
    }

    build.compile("de265");

    // Link C++ standard library
    match target_os.as_str() {
        "linux" => println!("cargo:rustc-link-lib=stdc++"),
        "macos" => println!("cargo:rustc-link-lib=c++"),
        // Windows MSVC links C++ runtime automatically
        _ => {}
    }

    // === Internal FFmpeg: link vendored static libs (feature `internal-ffmpeg`) ===
    if std::env::var("CARGO_FEATURE_INTERNAL_FFMPEG").is_ok() {
        link_internal_ffmpeg(&target_os);
        compile_ffmpeg_shim(&target_os);
    }
}

/// Compile the C accessor shim (`src/ffmpeg_shim.c`) against the vendored
/// FFmpeg headers and link it as a static lib named `shark_ffmpeg_shim`.
fn compile_ffmpeg_shim(target_os: &str) {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let platform_dir = match target_os {
        "windows" => "win-x64",
        "linux" => "linux-x64",
        _ => return,
    };
    let include_dir = std::path::Path::new(&manifest_dir)
        .join("vendor")
        .join("ffmpeg-static")
        .join(platform_dir)
        .join("include");
    if !include_dir.exists() {
        println!(
            "cargo:warning=ffmpeg shim: missing headers at {}",
            include_dir.display()
        );
        return;
    }
    let mut build = cc::Build::new();
    build
        .file("src/ffmpeg_shim.c")
        .include(&include_dir)
        .warnings(false);
    if target_os == "windows" {
        // FFmpeg headers expect inttypes/stdint that MSVC supports natively;
        // no extra defines needed.
    }
    build.compile("shark_ffmpeg_shim");
    println!("cargo:rerun-if-changed=src/ffmpeg_shim.c");
}

/// Emit cargo directives that link the prebuilt FFmpeg static libs from
/// `src-tauri/vendor/ffmpeg-static/<platform>/`.
///
/// The libs are produced by `scripts/build-ffmpeg-minimal.ps1 -StaticLibs`
/// (Windows) or `scripts/build-ffmpeg-minimal-linux.sh` (Linux). Both
/// scripts emit `lib/*.a` + `include/` derived from `make install`.
fn link_internal_ffmpeg(target_os: &str) {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set");
    let platform_dir = match target_os {
        "windows" => "win-x64",
        "linux" => "linux-x64",
        other => {
            println!("cargo:warning=internal-ffmpeg not supported on '{other}'");
            return;
        }
    };
    let vendor = std::path::Path::new(&manifest_dir)
        .join("vendor")
        .join("ffmpeg-static")
        .join(platform_dir);
    let lib_dir = vendor.join("lib");
    if !lib_dir.exists() {
        println!(
            "cargo:warning=internal-ffmpeg: missing static libs at {} \
             — run scripts/build-ffmpeg-minimal* first to populate them.",
            lib_dir.display()
        );
        return;
    }
    println!("cargo:rustc-link-search=native={}", lib_dir.display());
    // FFmpeg library link order matters: dependents first, dependencies last.
    for lib in &[
        "avformat",
        "avfilter",
        "avcodec",
        "swscale",
        "swresample",
        "avutil",
    ] {
        println!("cargo:rustc-link-lib=static={lib}");
    }
    // System libs each platform's libav* needs.
    match target_os {
        "windows" => {
            // NOTE: libmingw32.a is intentionally OMITTED — it provides MinGW's
            // startup glue (mainCRTStartup, tlssup) which collides with the
            // MSVC static CRT (`libcmt.lib`) in release builds (LNK4078 etc).
            //
            // libucrt.a IS included because it provides static implementations
            // of `_vscprintf`, `_vsnprintf`, `__imp__setjmp`, `__imp_longjmp`
            // which MinGW-built libmingwex/libwinpthread reference. It also
            // bundles `libapi-ms-win-crt-private-l1-1-0s00017.o` which
            // re-defines `__CxxFrameHandler3`, conflicting with MSVC's
            // libvcruntime.lib. We resolve that via `/FORCE:MULTIPLE` below
            // (first definition wins — Rust's release builds do not depend on
            // C++ SEH unwinding through MinGW objects).
            for lib in &["mingwex", "winpthread", "ucrt", "gcc"] {
                println!("cargo:rustc-link-lib=static={lib}");
            }
            // Allow LNK2005 duplicates to be silently de-duplicated. The only
            // known duplicate is `__CxxFrameHandler3` between libucrt.a's
            // private CRT stub and libvcruntime.lib's real implementation.
            println!("cargo:rustc-link-arg=/FORCE:MULTIPLE");
            // Ignore the resulting LNK4006/LNK4088 warnings to keep build log clean.
            println!("cargo:rustc-link-arg=/IGNORE:4006");
            println!("cargo:rustc-link-arg=/IGNORE:4088");
            // msvcrt.lib (import library) supplies `__imp__setjmp` /
            // `__imp_longjmp` as DLL-imports, which MinGW's libwinpthread
            // expects. This coexists with /DEFAULTLIB:ucrt.lib because UCRT
            // forwards the same symbols at runtime.
            println!("cargo:rustc-link-lib=dylib=msvcrt");
            for lib in &[
                "bcrypt", "secur32", "ws2_32", "user32", "gdi32",
                // hwaccel: D3D11 + DXVA2 + Media Foundation
                "d3d11", "dxgi", "dxguid", "ole32", "uuid", "mfplat", "mfuuid", "strmiids",
            ] {
                println!("cargo:rustc-link-lib=dylib={lib}");
            }
        }
        "linux" => {
            for lib in &["va", "va-drm", "drm", "z", "m", "pthread"] {
                println!("cargo:rustc-link-lib=dylib={lib}");
            }
        }
        _ => {}
    }
    // Tell cargo to rerun build.rs when libs change.
    println!("cargo:rerun-if-changed={}", lib_dir.display());
}

// === Windows SDK / MSVC include path discovery ===

fn find_windows_sdk_version_dir() -> Option<std::path::PathBuf> {
    let kits_root = std::path::Path::new(r"C:\Program Files (x86)\Windows Kits\10\Include");
    if !kits_root.exists() {
        return None;
    }
    // Pick the highest version directory
    let mut versions: Vec<_> = std::fs::read_dir(kits_root)
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .map(|e| e.path())
        .collect();
    versions.sort();
    versions.pop()
}

fn find_windows_sdk_ucrt_include() -> Option<String> {
    let ver = find_windows_sdk_version_dir()?;
    let ucrt = ver.join("ucrt");
    if ucrt.exists() {
        Some(ucrt.to_string_lossy().into_owned())
    } else {
        None
    }
}

fn find_windows_sdk_um_include() -> Option<String> {
    let ver = find_windows_sdk_version_dir()?;
    let um = ver.join("um");
    if um.exists() {
        Some(um.to_string_lossy().into_owned())
    } else {
        None
    }
}

fn find_windows_sdk_shared_include() -> Option<String> {
    let ver = find_windows_sdk_version_dir()?;
    let shared = ver.join("shared");
    if shared.exists() {
        Some(shared.to_string_lossy().into_owned())
    } else {
        None
    }
}

fn find_msvc_include() -> Option<String> {
    let tools_root = std::path::Path::new(
        r"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC",
    );
    if !tools_root.exists() {
        // Try Community edition
        let alt = std::path::Path::new(
            r"C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC",
        );
        if !alt.exists() {
            return None;
        }
        let mut versions: Vec<_> = std::fs::read_dir(alt)
            .ok()?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .map(|e| e.path())
            .collect();
        versions.sort();
        let inc = versions.pop()?.join("include");
        return if inc.exists() {
            Some(inc.to_string_lossy().into_owned())
        } else {
            None
        };
    }
    let mut versions: Vec<_> = std::fs::read_dir(tools_root)
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .map(|e| e.path())
        .collect();
    versions.sort();
    let inc = versions.pop()?.join("include");
    if inc.exists() {
        Some(inc.to_string_lossy().into_owned())
    } else {
        None
    }
}
