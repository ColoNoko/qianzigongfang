/**
 * 汉化工坊 · Photoshop 执行器（runner）
 * ================================================================
 *
 * 这口「锅」是固定的：它不含任何一次任务的具体数据，只负责读一份
 * 指令清单（manifest JSON）然后把活干完。工坊每次只换清单，不换它。
 *
 * 怎么跑起来（三种，任选）：
 *   1. 在 PS 里手动：文件 → 脚本 → 浏览… → 选中本文件 → 会弹窗让你挑清单 JSON
 *   2. 引子脚本：  $.qianziManifestPath = "D:/.../job.json"; $.evalFile(new File(".../qianzi-runner.jsx"))
 *   3. COM 直连：  同第 2 种的两行，通过 Photoshop.Application.DoJavaScript 送进来
 *
 * ⚠️ 这个文件是 ExtendScript（ES3，二十多年前的 JavaScript）：
 *    不能用 const/let、箭头函数、模板字符串、forEach/map/filter、JSON.parse。
 *    改这里之前先看一眼上面那行，否则 PS 会弹一个语焉不详的脚本错误。
 *
 * ⚠️ 样式三层合并（defaults → groups → labels[].styleOverride）与
 *    src/shared/labelplus-manifest.ts 的 resolveManifestTextStyle() 是同一套规则，
 *    改一边必须改另一边。那边有单测，这边没有 —— 所以这边改动要格外小心。
 *
 * 清单字段的权威定义同样在 src/shared/labelplus-manifest.ts。
 */

// ⚠️ 这一行的分号不能省。ExtendScript 的 ASI（自动补分号）不可靠：
//    少了它，下一行以 `(` 开头的语句会被粘上来，变成
//    `$.qianziRunnerVersion = '1.0.0'(function(){...})()` —— 把字符串当函数调用，
//    PS 报「错误 24: "1.0.0" 不是函数」。同理，代码里不要出现以 ( [ ` + - / 开头的行。
$.qianziRunnerVersion = '1.0.0';

// 主流程在下面；函数声明会提升，所以这里先启动没问题。
qianziRun();

function qianziRun() {
    // ================================================================
    // 0. 拿清单
    // ================================================================
    var manifest = null
    try {
        manifest = qianziLoadManifest()
    } catch (error) {
        alert('汉化工坊 runner：读不到指令清单。\n\n' + error)
        return
    }
    if (!manifest) {
        // 用户取消了文件选择，安静退出
        return
    }

    if (!qianziCheckManifest(manifest)) {
        return
    }

    var report = {
        manifestVersion: manifest.manifestVersion,
        jobId: manifest.jobId,
        runnerVersion: $.qianziRunnerVersion,
        startedAt: new Date().toString(),
        finishedAt: null,
        ok: false,
        generated: 0,
        failed: 0,
        skipped: 0,
        images: [],
        warnings: []
    }

    // 批处理脚本必须关掉交互式弹窗，否则一张图缺个字体整批就停在那儿等人点确定。
    // 干完要还原，不能把用户的 PS 永久设成静默。
    var previousDialogs = app.displayDialogs
    app.displayDialogs = DialogModes.NO

    try {
        qianziWriteReport(manifest, report)

        for (var i = 0; i < manifest.images.length; i++) {
            var image = manifest.images[i]
            var entry = null
            try {
                entry = qianziProcessImage(manifest, image)
            } catch (error) {
                entry = {
                    labelImageName: image.labelImageName,
                    status: 'failed',
                    outputPath: image.outputPath,
                    textLayerCount: 0,
                    message: '' + error,
                    warnings: [],
                    actions: []
                }
            }
            report.images.push(entry)
            if (entry.status === 'generated') report.generated++
            else if (entry.status === 'skipped') report.skipped++
            else report.failed++

            // 每张图刷一次回执 —— 工坊靠它显示进度，卡住的时候也看得出卡在第几张
            qianziWriteReport(manifest, report)
        }
    } finally {
        app.displayDialogs = previousDialogs
        report.finishedAt = new Date().toString()
        report.ok = report.failed === 0
        qianziWriteReport(manifest, report)
    }

    var summary = '汉化工坊：完成 ' + report.generated + ' 张'
    if (report.skipped > 0) summary += '，跳过 ' + report.skipped + ' 张'
    if (report.failed > 0) summary += '，失败 ' + report.failed + ' 张'
    alert(summary + '\n\n明细见回执：\n' + (manifest.report ? manifest.report.path : '(未指定)'))

    // ================================================================
    // 单张图的全部工作
    // ================================================================
    function qianziProcessImage(manifest, image) {
        var result = {
            labelImageName: image.labelImageName,
            status: 'failed',
            outputPath: image.outputPath,
            textLayerCount: 0,
            message: '',
            warnings: [],
            actions: []
        }

        var outputFile = new File(image.outputPath)
        if (manifest.job.overwrite === false && outputFile.exists) {
            result.status = 'skipped'
            result.message = '输出文件已存在，未覆盖'
            return result
        }

        // saveAs 不会自己建目录，而它报的错比「目录不存在」难懂得多。先建好。
        var outputFolder = outputFile.parent
        if (outputFolder && !outputFolder.exists && !outputFolder.create()) {
            result.message = '建不了输出目录：' + outputFolder.fsName
            return result
        }

        var backgroundFile = qianziResolveBackgroundFile(manifest, image)
        if (!backgroundFile || !backgroundFile.exists) {
            result.message = '找不到底图：' + (backgroundFile ? backgroundFile.fsName : '(未指定)')
            return result
        }

        var doc = app.open(backgroundFile)
        if (!doc) {
            result.message = '打开底图失败：' + backgroundFile.fsName
            return result
        }

        try {
            // 索引色文档没法建 RGB 文字层，先转过来（官方脚本同样这么做）
            if (doc.mode === DocumentMode.INDEXEDCOLOR) {
                doc.changeMode(ChangeMode.RGB)
            }

            if (Math.abs(doc.width.value - image.width) > 2 || Math.abs(doc.height.value - image.height) > 2) {
                result.warnings.push(
                    '文档尺寸与清单对不上：清单 ' + image.width + '×' + image.height +
                    '，实际 ' + Math.round(doc.width.value) + '×' + Math.round(doc.height.value) +
                    '。坐标已按实际文档换算（清单里的尺寸只用来发现「配错图了」）。'
                )
            }

            qianziRunNamedAction(manifest, manifest.actions.onStart, result, '打开时', true)

            var setCache = {}
            for (var i = 0; i < image.labels.length; i++) {
                qianziCreateLabelLayer(manifest, image.labels[i], doc, setCache, result)
            }

            qianziRunNamedAction(manifest, manifest.actions.onEnd, result, '收尾', true)

            var saveOptions = new PhotoshopSaveOptions()
            saveOptions.embedColorProfile = true
            doc.saveAs(outputFile, saveOptions, manifest.save.asCopy === true, Extension.LOWERCASE)

            result.status = 'generated'
            result.message = '已生成'
        } catch (error) {
            result.message = '' + error
        } finally {
            if (manifest.job.closeAfterSave !== false) {
                try {
                    doc.close(SaveOptions.DONOTSAVECHANGES)
                } catch (closeError) {
                    result.warnings.push('关闭文档失败：' + closeError)
                }
            }
        }

        return result
    }

    function qianziResolveBackgroundFile(manifest, image) {
        if (manifest.document.backgroundKind === 'existing-psd') {
            return manifest.document.existingPsdPath ? new File(manifest.document.existingPsdPath) : null
        }
        return image.sourcePath ? new File(image.sourcePath) : null
    }

    // ================================================================
    // 建一条文字层（顺序抄的是 LabelPlus 官方脚本：它在你机器上跑了很久）
    // ================================================================
    function qianziCreateLabelLayer(manifest, label, doc, setCache, result) {
        var groupConfig = manifest.groups ? manifest.groups[label.group] : null
        if (groupConfig && groupConfig.enabled === false) return
        if (!label.text || !qianziTrim(label.text)) return

        var style = qianziResolveStyle(
            manifest.defaults.textStyle,
            groupConfig ? groupConfig.textStyle : null,
            label.styleOverride
        )

        // v1 还没做图层样式。宁可吵一句，也不能让用户的描边/阴影静默消失。
        if (style.strokeWidthPx > 0) {
            qianziNoteOnce(result, '描边尚未在 Photoshop 模式下实现（本地出图模式有效）—— 这一批的描边会被丢掉')
        }
        if (style.shadow && style.shadow.enabled) {
            qianziNoteOnce(result, '阴影尚未在 Photoshop 模式下实现（本地出图模式有效）—— 这一批的阴影会被丢掉')
        }

        // 坐标是「相对原图的比例」，所以必须乘**实际打开的这张图**的尺寸。
        // 乘清单里声明的 image.width/height 是错的 —— 清单尺寸只用来发现「配错图了」。
        var docWidth = doc.width.value
        var docHeight = doc.height.value
        var x = docWidth * label.position.x
        var y = docHeight * label.position.y

        // 编号层（如果开了）建在文字之前，和官方脚本顺序一致
        if (manifest.document.outputLabelNumber) {
            var labelSet = qianziObtainLayerSet(doc, 'Label', setCache)
            var numberLayer = doc.artLayers.add()
            numberLayer.kind = LayerKind.TEXT
            var numberItem = numberLayer.textItem
            numberItem.font = manifest.document.labelNumberStyle.font.postScriptName
            numberItem.size = new UnitValue(manifest.document.labelNumberStyle.fontSizePx, 'px')
            numberItem.position = [new UnitValue(x, 'px'), new UnitValue(y, 'px')]
            numberItem.contents = String(label.index)
            numberItem.color = qianziSolidColor(manifest.document.labelNumberStyle.fillColor)
            numberLayer.name = 'Label ' + label.index
            if (labelSet) numberLayer.move(labelSet, ElementPlacement.PLACEATBEGINNING)
        }

        var layer = doc.artLayers.add()
        layer.kind = LayerKind.TEXT
        var item = layer.textItem

        try {
            item.kind = TextType.POINTTEXT
        } catch (kindError) {
            // 老版本 PS 没有这个枚举，默认就是点文字，不影响
        }
        item.size = new UnitValue(style.fontSizePx, 'px')
        item.font = style.font.postScriptName || style.font.family
        // 这一行就是「真竖排」的全部秘密：PS 自己会排，不需要我们算列宽和字距
        item.direction = style.direction === 'vertical' ? Direction.VERTICAL : Direction.HORIZONTAL
        item.antiAliasMethod = AntiAlias.SMOOTH
        // 自由连字。PS 的 TextItem 确实有这个属性（查过官方 DOM 属性表）。
        item.ligatures = style.ligatures !== false
        // 标准垂直罗马对齐方式（= 描述符里的 baselineDirection，1 开 / 2 关）：
        // **PS 这条路暂时设不了。**
        //
        // 2026-09-23 实测：PS 的 ExtendScript DOM 属性表里没有这个属性
        // （`item.baselineDirection = 1` 不报错，但生成的 PSD 里仍然是 2 —— 等于空写）。
        // 所以这里**不留那句看着像生效的死代码**，改成明确警告：
        // 静默产出错方向，比"设不上"危险得多。
        //
        // 真要做，得走 app.executeAction + ActionDescriptor（需要那个 4 字符键名）。
        // 本地路（ag-psd）是能写的，而且有真读写一圈的测试。
        if (style.direction === 'vertical' && style.standardVerticalRoman !== false) {
            qianziNoteOnce(
                result,
                '「标准垂直罗马对齐方式」在 Photoshop 这条路上暂时不支持（PS 的脚本 DOM 没暴露它）—— ' +
                    '这一批竖排里的拉丁字母/数字会被转 90°。需要它请用本地「生成 PSD」。'
            )
        }
        item.position = [new UnitValue(x, 'px'), new UnitValue(y, 'px')]

        if (manifest.document.layerGroupMode !== 'flat') {
            var layerSet = qianziObtainLayerSet(doc, label.group, setCache)
            if (layerSet) layer.move(layerSet, ElementPlacement.PLACEATBEGINNING)
        }

        item.contents = label.text
        item.useAutoLeading = true
        if (style.leadingPercent) item.autoLeadingAmount = style.leadingPercent
        try {
            item.justification = qianziJustification(style.alignment)
        } catch (justifyError) {
            // 点文字在部分语言环境下不吃对齐，跳过即可
        }
        item.color = qianziSolidColor(style.fillColor)

        layer.name = qianziLayerName(label.text)
        result.textLayerCount++

        // 动作是对「当前选中的图层」生效的，所以紧接着建完就跑，中间不能插别的事
        var actionName = qianziActionName(manifest, label.group)
        if (actionName) {
            doc.activeLayer = layer
            var outcome = qianziDoAction(manifest, actionName, result, '分组「' + label.group + '」')
            qianziRecordAction(result, label.group, actionName, outcome.ok)
        }
    }

    function qianziObtainLayerSet(doc, name, setCache) {
        if (setCache[name]) return setCache[name]
        var created = doc.layerSets.add()
        created.name = name
        setCache[name] = created
        return created
    }

    /**
     * 同一条提示只记一次。
     *
     * 一张图里同一个分组有十条文字，动作不存在就会产生十条**一模一样的**警告 ——
     * 回执被刷屏之后，真正的报错反而看不见了（界面上只显示前 6 条）。
     */
    function qianziNoteOnce(result, message) {
        for (var i = 0; i < result.warnings.length; i++) {
            if (result.warnings[i] === message) { return; }
        }
        result.warnings.push(message)
    }

    /**
     * 把一次动作执行的结果并进 `actions`，按「分组 + 动作」聚合。
     *
     * 同一个动作是一张图里**每条文字各跑一次**的，逐条 push 会让回执里躺着
     * 十几条一模一样的记录。这里只留一条，用 `count` 记它实际跑了几次；
     * 只要有一次失败，`ok` 就是 false（一次失败不能被后面的成功盖掉）。
     */
    function qianziRecordAction(result, group, action, ok) {
        for (var i = 0; i < result.actions.length; i++) {
            var entry = result.actions[i]
            if (entry.group === group && entry.action === action) {
                entry.count = (entry.count || 1) + 1
                entry.ok = entry.ok && ok
                return
            }
        }
        result.actions.push({ group: group, action: action, ok: ok, count: 1 })
    }

    function qianziLayerName(text) {
        var normalized = qianziTrim(('' + text).replace(/[\r\n\t]+/g, ' '))
        if (!normalized) return '空文本'
        return normalized.length > 120 ? normalized.substring(0, 117) + '...' : normalized
    }

    // ================================================================
    // 动作
    // ================================================================
    function qianziActionName(manifest, groupName) {
        if (!manifest.actions || manifest.actions.enabled !== true) return ''
        var groupConfig = manifest.groups ? manifest.groups[groupName] : null
        if (groupConfig && groupConfig.enabled === false) return ''
        // 动作名留空 → 用分组名（官方脚本的老规矩，现有动作集不用改）
        var explicit = groupConfig && groupConfig.action ? qianziTrim(groupConfig.action) : ''
        return explicit ? explicit : groupName
    }

    /**
     * `_start` / `_end` 是**可选钩子**：动作组里没有它们才是常态
     * （用户的「三图层」就只有 `_end`、没有 `_start`）。
     * 所以它们传 `quiet = true` —— 不存在就安静跳过；但**存在却执行失败**照样要报，
     * 那是真出事了，不能吞掉。
     */
    function qianziRunNamedAction(manifest, actionName, result, when, quiet) {
        if (!actionName || !qianziTrim(actionName)) return
        if (!manifest.actions || manifest.actions.enabled !== true) return
        qianziDoAction(manifest, qianziTrim(actionName), result, when, quiet)
    }

    function qianziDoAction(manifest, actionName, result, context, quiet) {
        try {
            app.doAction(actionName, manifest.actions.setName)
            return { ok: true }
        } catch (error) {
            var message = '' + error
            // PS 对「动作不存在」的报错措辞就长这样；官方脚本也是靠这个字符串判断的
            var missing = /not currently available|not available|找不到|不可用/i.test(message)
            if (missing && manifest.actions.skipMissing !== false) {
                if (!quiet) {
                    qianziNoteOnce(result, context + '：动作「' + actionName + '」不存在，已跳过')
                }
                return { ok: false }
            }
            qianziNoteOnce(result, context + '：动作「' + actionName + '」执行失败 —— ' + message)
            return { ok: false }
        }
    }

    // ================================================================
    // 样式三层合并（与 shared/labelplus-manifest.ts 的规则必须一致）
    // ================================================================
    function qianziResolveStyle(defaults, groupStyle, labelStyle) {
        var g = groupStyle || {}
        var l = labelStyle || {}
        function pick(a, b, c) {
            if (a !== undefined && a !== null) return a
            if (b !== undefined && b !== null) return b
            return c
        }
        return {
            font: pick(l.font, g.font, defaults.font),
            fontSizePx: pick(l.fontSizePx, g.fontSizePx, defaults.fontSizePx),
            direction: pick(l.direction, g.direction, defaults.direction),
            leadingPercent: pick(l.leadingPercent, g.leadingPercent, defaults.leadingPercent),
            alignment: pick(l.alignment, g.alignment, defaults.alignment),
            fillColor: pick(l.fillColor, g.fillColor, defaults.fillColor),
            strokeColor: pick(l.strokeColor, g.strokeColor, defaults.strokeColor),
            strokeWidthPx: pick(l.strokeWidthPx, g.strokeWidthPx, defaults.strokeWidthPx),
            fauxBold: pick(l.fauxBold, g.fauxBold, defaults.fauxBold),
            fauxItalic: pick(l.fauxItalic, g.fauxItalic, defaults.fauxItalic),
            ligatures: pick(l.ligatures, g.ligatures, defaults.ligatures),
            standardVerticalRoman: pick(l.standardVerticalRoman, g.standardVerticalRoman, defaults.standardVerticalRoman),
            shadow: pick(l.shadow, g.shadow, defaults.shadow)
        }
    }

    function qianziJustification(alignment) {
        if (alignment === 'center') return Justification.CENTER
        if (alignment === 'right') return Justification.RIGHT
        return Justification.LEFT
    }

    function qianziSolidColor(hex) {
        var parsed = qianziParseHex(hex)
        var color = new SolidColor()
        color.rgb.red = parsed.r
        color.rgb.green = parsed.g
        color.rgb.blue = parsed.b
        return color
    }

    function qianziParseHex(value) {
        var normalized = qianziTrim('' + (value === undefined || value === null ? '#000000' : value))
        if (normalized.charAt(0) === '#') normalized = normalized.substring(1)
        if (normalized.length === 3) {
            normalized = normalized.charAt(0) + normalized.charAt(0) +
                normalized.charAt(1) + normalized.charAt(1) +
                normalized.charAt(2) + normalized.charAt(2)
        }
        if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return { r: 0, g: 0, b: 0 }
        return {
            r: parseInt(normalized.substring(0, 2), 16),
            g: parseInt(normalized.substring(2, 4), 16),
            b: parseInt(normalized.substring(4, 6), 16)
        }
    }

    function qianziTrim(value) {
        return ('' + value).replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '')
    }
}

// ====================================================================
// 清单的读入与回执的写出（放在主流程外面，引子脚本可以复用）
// ====================================================================

function qianziLoadManifest() {
    if ($.qianziManifest) return $.qianziManifest

    var path = $.qianziManifestPath
    if (!path) {
        var picked = File.openDialog('请选择汉化工坊的指令清单 (.json)')
        if (!picked) return null
        path = picked.fsName
    }

    var file = new File(path)
    if (!file.exists) throw new Error('清单文件不存在：' + path)
    file.encoding = 'UTF8'
    if (!file.open('r')) throw new Error('打不开清单文件：' + path)
    var text = file.read()
    file.close()

    return qianziParseJson(text)
}

/**
 * ExtendScript 不保证有 JSON 对象，所以退回到 eval —— 这也是 LabelPlus 官方脚本
 * 自己用的办法。清单是工坊写出来的本地文件，不接受外部输入。
 *
 * ⚠️ 用 eval 的**返回值**，不写成 `eval('value = (...)')`：ExtendScript 的 eval
 *    不一定看得见本函数的局部变量，赋给局部变量可能悄悄失效。取返回值最稳。
 *    外面那层括号也不能省 —— 否则 `{...}` 会被当成语句块而不是对象。
 */
function qianziParseJson(text) {
    var cleaned = ('' + text).replace(/^\uFEFF/, '')
    if (typeof JSON !== 'undefined' && JSON.parse) {
        return JSON.parse(cleaned)
    }
    return eval('(' + cleaned + ')')
}

function qianziCheckManifest(manifest) {
    // 这里只做「不检查就一定看不懂后面报错」的那几条；完整校验在工坊侧
    // （shared/labelplus-manifest.ts 的 validateLabelPlusManifest）。
    if (!manifest || typeof manifest !== 'object') {
        alert('汉化工坊 runner：清单内容不是一个对象。')
        return false
    }
    if (manifest.manifestVersion !== 2) {
        alert(
            '汉化工坊 runner：清单版本不兼容。\n\n' +
            '这个执行器只认第 2 版，清单是第 ' + manifest.manifestVersion + ' 版。\n' +
            '请升级汉化工坊里的 qianzi-runner.jsx。'
        )
        return false
    }
    if (!manifest.images || !manifest.images.length) {
        alert('汉化工坊 runner：清单里一张图都没有。')
        return false
    }
    return true
}

function qianziWriteReport(manifest, report) {
    if (!manifest.report || !manifest.report.path) return
    try {
        var file = new File(manifest.report.path)
        // 回执目录同样可能还不存在（输出目录刚被建出来的那一刻）
        var folder = file.parent
        if (folder && !folder.exists) { folder.create(); }
        file.encoding = 'UTF8'
        if (!file.open('w')) { return; }
        file.write(qianziToJson(report))
        file.close()
    } catch (error) {
        // 回执写不出来不该让整批活儿失败，PS 里也别弹窗打断
    }
}

// ====================================================================
// 极简 JSON 序列化（ES3，只够用，不追求通用）
// ====================================================================

function qianziToJson(value) {
    if (value === null || value === undefined) return 'null'
    if (value instanceof Array) {
        var items = []
        for (var i = 0; i < value.length; i++) items.push(qianziToJson(value[i]))
        return '[' + items.join(',') + ']'
    }
    if (typeof value === 'object') {
        var members = []
        for (var key in value) {
            // ⚠️ ExtendScript 不会给 continue 自动补分号（ES3 的受限语句），
            //    这两个大括号和分号一个都不能省，否则 PS 报「错误 25: 应为: ;」。
            if (!value.hasOwnProperty(key)) { continue; }
            if (value[key] === undefined) { continue; }
            members.push(qianziJsonString(key) + ':' + qianziToJson(value[key]))
        }
        return '{' + members.join(',') + '}'
    }
    if (typeof value === 'number') return isFinite(value) ? '' + value : 'null'
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    return qianziJsonString('' + value)
}

function qianziJsonString(value) {
    var text = '' + value
    var out = '"'
    for (var i = 0; i < text.length; i++) {
        var character = text.charAt(i)
        var code = text.charCodeAt(i)
        if (character === '"') out += '\\"'
        else if (character === '\\') out += '\\\\'
        else if (character === '\n') out += '\\n'
        else if (character === '\r') out += '\\r'
        else if (character === '\t') out += '\\t'
        else if (code < 32) out += '\\u' + ('0000' + code.toString(16)).slice(-4)
        else out += character
    }
    return out + '"'
}
