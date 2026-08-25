#!/usr/bin/env python3
"""
导入 docs/samplePrompt 样本提示词到 pmf.db（临时脚本）

约定与 src-tauri/src/commands/migration.rs 保持一致：
- module id 格式: mod_{维度key}_{编号:02}（如 mod_body_01）
- is_nsfw: 11 个维度（body/face/top/bottom/outfit/shoes/accessories/pose/props/background/camera）
  的 _15 / _26 / _27 / _28 标记为 NSFW（对应 Rust NSFW_MODULE_IDS）
- is_enabled: mod_gender_11 ~ mod_gender_15 禁用（对应 Rust DISABLED_GENDER_IDS）
- display_name: 每条提示词的简体中文短概括
"""

import sqlite3
import os
import time

DB_PATH = r"F:\MyProgram\PromptTool\src-tauri\target\release\data\pmf.db"
PROMPT_DIR = r"F:\MyProgram\PromptTool\docs\samplePrompt"

# 维度 key → 中文简称（生成 display_name 用）
SHORT_CN = {
    "accessories": "配饰", "background": "背景", "body": "身材", "bottom": "下装",
    "camera": "相机", "ethnicity": "人种", "face": "面部", "gender": "性别",
    "height": "身高", "outfit": "套装", "pose": "姿势", "props": "道具",
    "shoes": "鞋袜", "top": "上装",
}

# 简体中文短概括，key = "{维度key}_{编号}"
DISPLAY_NAMES = {
    # gender 模特性别
    "gender_01": "女性模特",
    "gender_02": "男性模特",
    "gender_03": "柔美女性",
    "gender_04": "自然女性",
    "gender_05": "中性酷感女性",
    "gender_06": "柔和男性",
    "gender_07": "自然男性",
    "gender_08": "精致男性",
    "gender_09": "中性模特",
    "gender_10": "优雅女性",
    "gender_11": "中性短发",
    "gender_12": "中性西装风",
    "gender_13": "华丽女性风",
    "gender_14": "中性简洁",
    "gender_15": "裸肩中性肖像",
    # ethnicity 模特人种
    "ethnicity_01": "东亚面孔",
    "ethnicity_02": "南亚面孔",
    "ethnicity_03": "东南亚面孔",
    "ethnicity_04": "欧洲面孔",
    "ethnicity_05": "西非面孔",
    "ethnicity_06": "东非面孔",
    "ethnicity_07": "中东面孔",
    "ethnicity_08": "拉美面孔",
    "ethnicity_09": "混血面孔",
    "ethnicity_10": "中亚面孔",
    "ethnicity_11": "太平洋岛民",
    "ethnicity_12": "北欧面孔",
    "ethnicity_13": "地中海面孔",
    "ethnicity_14": "非裔加勒比",
    "ethnicity_15": "模糊人种",
    "ethnicity_16": "汉族面孔",
    "ethnicity_17": "壮族面孔",
    "ethnicity_18": "维吾尔族面孔",
    "ethnicity_19": "回族面孔",
    "ethnicity_20": "满族面孔",
    "ethnicity_21": "苗族面孔",
    "ethnicity_22": "彝族面孔",
    "ethnicity_23": "藏族面孔",
    "ethnicity_24": "蒙古族面孔",
    "ethnicity_25": "侗族面孔",
    "ethnicity_26": "朝鲜族面孔",
    "ethnicity_27": "傣族面孔",
    # height 模特身高
    "height_01": "135cm非常娇小",
    "height_02": "150cm小巧",
    "height_03": "160cm中等身材",
    "height_04": "170cm高挑",
    "height_05": "180cm模特身高",
    "height_06": "190cm超模身高",
    # body 模特身材特点
    "body_01": "沙漏型好身材",
    "body_02": "纤细娇小",
    "body_03": "高挑健美",
    "body_04": "丰满曲线",
    "body_05": "苗条紧致",
    "body_06": "丰腴饱满",
    "body_07": "修长优雅",
    "body_08": "肌肉型身材",
    "body_09": "大码丰润",
    "body_10": "紧实匀称",
    "body_11": "梨形身材",
    "body_12": "蜂腰沙漏身",
    "body_13": "娇小丰满",
    "body_14": "高挑纤细",
    "body_15": "裸体写真",  # NSFW
    "body_16": "清瘦高挑",
    "body_17": "柔和沙漏身",
    "body_18": "倒三角体型",
    "body_19": "小巧精致",
    "body_20": "高挑典雅",
    "body_21": "自信曲线",
    "body_22": "力量腹肌",
    "body_23": "柔韧纤细",
    "body_24": "大码优雅",
    "body_25": "阳光晒肤",
    "body_26": "柔和裸体剪影",  # NSFW
    "body_27": "露肩美背",  # NSFW
    "body_28": "裸露身材",  # NSFW
    # face 模特面部特点
    "face_01": "鹅蛋脸自然妆",
    "face_02": "圆脸大眼",
    "face_03": "心形脸丰唇",
    "face_04": "棱角脸烟熏妆",
    "face_05": "方脸浓眉",
    "face_06": "娃娃脸",
    "face_07": "亚洲单眼皮",
    "face_08": "雀斑绿眸",
    "face_09": "成熟深邃",
    "face_10": "幼态面容",
    "face_11": "高鼻蓝眸",
    "face_12": "狐狸眼",
    "face_13": "混血面容",
    "face_14": "瓷肌黑发",
    "face_15": "魅惑表情",  # NSFW
    "face_16": "柔和微笑",
    "face_17": "立体颧骨",
    "face_18": "明亮眉眼",
    "face_19": "柔和雀斑",
    "face_20": "猫眼眼线",
    "face_21": "甜笑酒窝",
    "face_22": "冷冽面容",
    "face_23": "暖棕眼眸",
    "face_24": "立体轮廓",
    "face_25": "水光肌",
    "face_26": "迷离凝视",  # NSFW
    "face_27": "魅惑微笑",  # NSFW
    "face_28": "潮红喘息",  # NSFW
    # top 模特上装
    "top_01": "宽松白衬衫",
    "top_02": "米色短开衫",
    "top_03": "黑色真丝吊带",
    "top_04": "白棉T恤",
    "top_05": "做旧牛仔外套",
    "top_06": "藏青真丝衬衫",
    "top_07": "奶油色露肩毛衣",
    "top_08": "黑色皮夹克",
    "top_09": "透视网纱上衣",
    "top_10": "海军条纹衫",
    "top_11": "炭灰羊绒高领",
    "top_12": "泡泡袖碎花衫",
    "top_13": "白色罗纹背心",
    "top_14": "白色蕾丝内衣",
    "top_15": "敞怀露胸衬衫",  # NSFW
    "top_16": "浅蓝短牛仔衣",
    "top_17": "灰色连帽卫衣",
    "top_18": "奶油色修身针织",
    "top_19": "米色亚麻无袖衫",
    "top_20": "红黑格纹衬衫",
    "top_21": "碎花透视雪纺",
    "top_22": "白色系带短背心",
    "top_23": "橄榄绿亨利衫",
    "top_24": "银色亮片短上衣",
    "top_25": "酒红丝绒吊带",
    "top_26": "透纱蕾丝显内衣",  # NSFW
    "top_27": "短上衣露胸缘",  # NSFW
    "top_28": "无罩敞怀衬衫",  # NSFW
    # bottom 模特下装
    "bottom_01": "高腰格纹百褶裙",
    "bottom_02": "浅色阔腿牛仔裤",
    "bottom_03": "黑色皮革短裙",
    "bottom_04": "米色直筒西裤",
    "bottom_05": "磨边牛仔短裤",
    "bottom_06": "白色亚麻阔腿裤",
    "bottom_07": "灰色锥形卫裤",
    "bottom_08": "藏青中长百褶裙",
    "bottom_09": "高腰黑色紧身裤",
    "bottom_10": "格纹A字裙",
    "bottom_11": "橄榄绿工装裤",
    "bottom_12": "香槟色丝绸半裙",
    "bottom_13": "棕色喇叭灯芯绒",
    "bottom_14": "黑色超短牛仔裤",
    "bottom_15": "透视蕾丝内裤",  # NSFW
    "bottom_16": "白色百褶网球裙",
    "bottom_17": "卡其阔腿工装裤",
    "bottom_18": "深色高腰紧身裤",
    "bottom_19": "香槟缎面阔腿裤",
    "bottom_20": "酒红皮短裙",
    "bottom_21": "米色纸袋短裤",
    "bottom_22": "炭灰羊毛西裤",
    "bottom_23": "蓝色牛仔中长裙",
    "bottom_24": "芥末黄阔腿裤",
    "bottom_25": "粉色荷叶边短裙",
    "bottom_26": "高开衩露底裙",  # NSFW
    "bottom_27": "低腰露胯裤",  # NSFW
    "bottom_28": "透视高叉内裤",  # NSFW
    # outfit 模特全身套装
    "outfit_01": "红色紧身连衣裙",
    "outfit_02": "牛仔连体裤",
    "outfit_03": "黑色缎面吊带裙",
    "outfit_04": "白色亚麻衬衫裙",
    "outfit_05": "藏青职业套装",
    "outfit_06": "碎花吊带连衣裙",
    "outfit_07": "灰色针织连衣裙",
    "outfit_08": "黑色皮革紧身裙",
    "outfit_09": "米色风衣连衣裙",
    "outfit_10": "祖母绿真丝裹身裙",
    "outfit_11": "白色层叠棉质裙",
    "outfit_12": "黑色高领中长裙",
    "outfit_13": "粉色缎面吊带裙",
    "outfit_14": "宽松牛仔背带裙",
    "outfit_15": "黑色蕾丝内衣套装",  # NSFW
    "outfit_16": "香槟缎面吊带裙",
    "outfit_17": "黑色阔腿连体裤",
    "outfit_18": "米色针织居家套装",
    "outfit_19": "祖母绿丝绒晚礼服",
    "outfit_20": "浅蓝衬衫连衣裙",
    "outfit_21": "芥末黄百褶中长裙",
    "outfit_22": "浅色牛仔背带裙",
    "outfit_23": "金色亮片派对裙",
    "outfit_24": "陶土色亚麻裹身裙",
    "outfit_25": "奶油金扣粗花呢裙",
    "outfit_26": "深V缎面贴身裙",  # NSFW
    "outfit_27": "透视紧身连衣裙",  # NSFW
    "outfit_28": "黑蕾丝内衣套装",  # NSFW
    # shoes 模特鞋袜
    "shoes_01": "白色极简运动鞋",
    "shoes_02": "黑色过膝丝袜",
    "shoes_03": "裸色尖头高跟鞋",
    "shoes_04": "白色花边短袜",
    "shoes_05": "棕色粗跟短靴",
    "shoes_06": "黑色漆皮乐福鞋",
    "shoes_07": "米色圆头芭蕾鞋",
    "shoes_08": "黑色过膝皮靴",
    "shoes_09": "白色帆布高帮鞋",
    "shoes_10": "黑色透肤过膝袜",
    "shoes_11": "裸色细带凉鞋",
    "shoes_12": "灰色罗纹长筒袜",
    "shoes_13": "黑色厚底靴",
    "shoes_14": "白色渔网过膝袜",
    "shoes_15": "赤足写真",  # NSFW
    "shoes_16": "黑色厚底乐福鞋",
    "shoes_17": "裸色粗跟绑带鞋",
    "shoes_18": "棕褐绒面短靴",
    "shoes_19": "白色帆布懒人鞋",
    "shoes_20": "黑色丝绒小猫跟",
    "shoes_21": "白米运动凉鞋",
    "shoes_22": "灰色过膝麂皮靴",
    "shoes_23": "黑色漆皮玛丽珍",
    "shoes_24": "白色针织袜靴",
    "shoes_25": "棕色雕花牛津鞋",
    "shoes_26": "吊带袜大腿袜",  # NSFW
    "shoes_27": "蕾丝边过膝袜",  # NSFW
    "shoes_28": "赤足特写",  # NSFW
    # accessories 模特配饰
    "accessories_01": "金圈耳环小挎包",
    "accessories_02": "银坠项链圆光镜",
    "accessories_03": "珍珠耳钉皮表",
    "accessories_04": "黑宽檐帽眼镜",
    "accessories_05": "金链叠戒",
    "accessories_06": "丝巾猫眼光镜",
    "accessories_07": "金扣皮带",
    "accessories_08": "条纹帆布托特包",
    "accessories_09": "几何银耳饰",
    "accessories_10": "金色叠戴手镯",
    "accessories_11": "绗缝迷你双肩包",
    "accessories_12": "金框阅读眼镜",
    "accessories_13": "奶油色大丝圈发圈",
    "accessories_14": "树脂戒指夸张耳饰",
    "accessories_15": "锁骨身体链",  # NSFW
    "accessories_16": "复古珍珠choker",
    "accessories_17": "超大金圈耳环",
    "accessories_18": "马卡龙宽丝发带",
    "accessories_19": "棕褐皮革斜挎包",
    "accessories_20": "金色粗链项链",
    "accessories_21": "黑色小巧方光镜",
    "accessories_22": "彩色串珠晚宴包",
    "accessories_23": "棕色细皮带",
    "accessories_24": "水晶发夹一对",
    "accessories_25": "驼色羊毛贝雷帽",
    "accessories_26": "露背细链",  # NSFW
    "accessories_27": "锁骨链饰",  # NSFW
    "accessories_28": "蕾丝缎带choker",  # NSFW
    # pose 模特姿势
    "pose_01": "插兜站立",
    "pose_02": "侧坐翘腿",
    "pose_03": "靠墙抱臂",
    "pose_04": "迎面行走",
    "pose_05": "椅上前倾",
    "pose_06": "叉腰歪头",
    "pose_07": "蹲踞姿势",
    "pose_08": "回眸侧身",
    "pose_09": "自然站姿",
    "pose_10": "抱膝坐地",
    "pose_11": "举手后仰",
    "pose_12": "单膝跪地",
    "pose_13": "桌沿垂腿坐",
    "pose_14": "侧身远望",
    "pose_15": "仰躺举手",  # NSFW
    "pose_16": "大步行走",
    "pose_17": "端坐交腿",
    "pose_18": "手肘撑膝",
    "pose_19": "自信抱臂",
    "pose_20": "高脚凳伸腿",
    "pose_21": "行走回望",
    "pose_22": "背手直立",
    "pose_23": "蹲姿托膝",
    "pose_24": "沙发倚靠",
    "pose_25": "空中跃起",
    "pose_26": "床上屈膝卧",  # NSFW
    "pose_27": "侧卧叉腰",  # NSFW
    "pose_28": "仰躺开腿",  # NSFW
    # props 交互物品
    "props_01": "手持咖啡杯",
    "props_02": "倚靠栏杆",
    "props_03": "手捧书本",
    "props_04": "手提购物袋",
    "props_05": "持机通话",
    "props_06": "怀抱花束",
    "props_07": "倚靠雨伞",
    "props_08": "手持红酒",
    "props_09": "手提皮包",
    "props_10": "把玩手机",
    "props_11": "执笔书写",
    "props_12": "托腮沉思",
    "props_13": "照镜顾盼",
    "props_14": "把玩钥匙扣",
    "props_15": "披丝袍半遮身",  # NSFW
    "props_16": "手拿翻页书本",
    "props_17": "手提帆布袋",
    "props_18": "浅啜咖啡",
    "props_19": "举机自拍",
    "props_20": "撑伞过头",
    "props_21": "手持黑胶唱片",
    "props_22": "随意持花",
    "props_23": "手捧笔记本电脑",
    "props_24": "手持太阳镜",
    "props_25": "手持滑板",
    "props_26": "薄纱遮身",  # NSFW
    "props_27": "丝袍滑肩",  # NSFW
    "props_28": "丝袍半遮露肤",  # NSFW
    # background 背景风格
    "background_01": "极简影棚白幕",
    "background_02": "樱花街景",
    "background_03": "霓虹夜巷",
    "background_04": "温馨咖啡馆",
    "background_05": "金色落日沙滩",
    "background_06": "欧式石板老街",
    "background_07": "现代玻璃办公室",
    "background_08": "繁茂植物园",
    "background_09": "屋顶城市天际线",
    "background_10": "晨光卧室",
    "background_11": "阴雨街景",
    "background_12": "复古图书馆",
    "background_13": "白沙荒漠",
    "background_14": "涩谷十字路口",
    "background_15": "昏暗酒店床榻",  # NSFW
    "background_16": "温馨书店",
    "background_17": "极简水泥阁楼",
    "background_18": "海边木栈道",
    "background_19": "秋日金叶林",
    "background_20": "黄昏街灯",
    "background_21": "屋顶花园",
    "background_22": "复古霓虹餐车",
    "background_23": "雪后街道",
    "background_24": "白墙美术馆",
    "background_25": "工业砖墙仓库",
    "background_26": "昏暗私人卧室",  # NSFW
    "background_27": "昏灯暧昧酒店",  # NSFW
    "background_28": "昏暗酒店床榻",  # NSFW
    # camera 相机参数
    "camera_01": "85mm浅景深柔光",
    "camera_02": "50mm自然光人像",
    "camera_03": "35mm广角环境人像",
    "camera_04": "135mm长焦虚化",
    "camera_05": "24mm低角度电影感",
    "camera_06": "微距特写环形灯",
    "camera_07": "85mm逆光黄昏",
    "camera_08": "70mm影棚柔光箱",
    "camera_09": "100mm美妆灯光",
    "camera_10": "28mm街头抓拍",
    "camera_11": "85mm轮廓光暗背景",
    "camera_12": "50mm窗光柔影",
    "camera_13": "135mm高调过曝",
    "camera_14": "35mm胶片颗粒复古",
    "camera_15": "85mm烛光闺房风",  # NSFW
    "camera_16": "50mm平视角散景",
    "camera_17": "35mm俯拍平铺",
    "camera_18": "85mm眼部特写",
    "camera_19": "24mm广角壮观天空",
    "camera_20": "70mm侧光柔影",
    "camera_21": "100mm微距纹理",
    "camera_22": "28mm荷兰角动感",
    "camera_23": "85mm自然窗光",
    "camera_24": "50mm夜景城市光斑",
    "camera_25": "逆光光晕剪影",
    "camera_26": "亲密特写暖光",  # NSFW
    "camera_27": "细腻肌肤虚化",  # NSFW
    "camera_28": "烛光闺房暖调",  # NSFW
}

# 与 Rust NSFW_MODULE_IDS 相同的集合（11 个维度的 _15/_26/_27/_28）
NSFW_DIMENSIONS = [
    "body", "face", "top", "bottom", "outfit", "shoes",
    "accessories", "pose", "props", "background", "camera",
]
NSFW_IDS = {
    f"mod_{d}_{n:02}"
    for d in NSFW_DIMENSIONS
    for n in [15, 26, 27, 28]
}

# 与 Rust DISABLED_GENDER_IDS 相同的集合
DISABLED_IDS = {f"mod_gender_{n:02}" for n in range(11, 16)}


def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # 清理此前用随机 id 导入的数据（mod_xxx 仅一个下划线的旧格式）
    deleted = cur.execute(
        "DELETE FROM modules WHERE id NOT GLOB 'mod_*_*'"
    ).rowcount
    if deleted:
        print(f"已清理旧格式记录 {deleted} 条")

    # 维度 key → id
    dim_key_to_id = {r[1]: r[0] for r in
        cur.execute("SELECT id, key FROM dimensions").fetchall()}

    total = 0
    missing_display = []
    for folder in sorted(os.listdir(PROMPT_DIR)):
        folder_path = os.path.join(PROMPT_DIR, folder)
        if not os.path.isdir(folder_path):
            continue
        dim_id = dim_key_to_id.get(folder)
        if not dim_id:
            print(f"  ⚠ 无对应维度: {folder}")
            continue

        txt_files = sorted(f for f in os.listdir(folder_path) if f.endswith(".txt"))
        now = int(time.time())
        count = 0

        for filename in txt_files:
            stem = os.path.splitext(filename)[0]
            num = int(stem.split("_")[-1])
            module_id = f"mod_{folder}_{num:02}"
            content = open(os.path.join(folder_path, filename), encoding="utf-8").read().strip()
            if not content:
                continue

            display_name = DISPLAY_NAMES.get(f"{folder}_{num:02}")
            if not display_name:
                missing_display.append(f"{folder}_{num:02}")
                display_name = content  # 兜底

            is_nsfw = 1 if module_id in NSFW_IDS else 0
            is_enabled = 0 if module_id in DISABLED_IDS else 1
            ts = now + num  # 同一维度内 created_at 随编号递增，保证排序稳定

            cur.execute(
                """INSERT OR REPLACE INTO modules
                   (id, dimension_id, content_en, display_name, weight,
                    is_enabled, is_nsfw, usage_count, example_image, notes,
                    created_at, updated_at, is_deleted)
                   VALUES (?, ?, ?, ?, 1.0, ?, ?, 0, NULL, NULL, ?, ?, 0)""",
                (module_id, dim_id, content, display_name, is_enabled,
                 is_nsfw, ts, ts),
            )
            count += 1
            total += 1

        print(f"  {folder:15s} → 写入 {count:3d} 条")

    conn.commit()
    conn.close()

    print(f"\n✅ 完成，共写入 {total} 条记录")
    if missing_display:
        print(f"  ⚠ 缺少中文概括的条目: {missing_display}")


if __name__ == "__main__":
    main()