/**
 * 手动测试引子 —— 不经过汉化工坊，直接把一份清单塞给 runner
 * ================================================================
 *
 * 用法：
 *   1. 把下面两个路径改成你机器上的真实路径。
 *      Windows 路径请用正斜杠（/）或双反斜杠（\\），单个反斜杠会被当成转义。
 *   2. Photoshop 菜单：文件 → 脚本 → 浏览… → 选中本文件。
 *   3. 看 PS 有没有按清单干活，以及清单里 report.path 指的 .json 有没有生成。
 *
 * 这条路完全不依赖「PS 已经开着时命令行能不能执行 .jsx」那个问题 ——
 * 是你手动从菜单里跑的，所以它一定执行。
 */

// 指令清单（先用 docs/samples 里那份样例，改好里面的路径再跑）
$.qianziManifestPath = 'D:/path/to/hanhuagongfang/docs/samples/labelplus-manifest.sample.json'

// 执行器本体
$.qianziRunnerScriptPath = 'D:/path/to/comic/汉化工坊0.3.0/qianzi-source/resources/qianzi-runner.jsx'

$.evalFile(new File($.qianziRunnerScriptPath))
