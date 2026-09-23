# 商品目录与定价更新(Price_List.xlsx)

flintmarrow.com 的商品和价格以用户提供的供应商价格表为准:

- 来源:`~/Desktop/Price_List.xlsx` 的 `Sheet1`,A 列产品编号、B 列产品名称、C 列规格、**H 列「<200 Boxes (Total Order)」美元价(每盒 10 支)**。I 列备注只用于标记缺货行和记录总体条款。
- 表里每一行都必须在前台恰好出现一次;网站价格 = H 列 × 100 美分,写到规格的 USD 常规价(country_code = US)。
- 名称按前台既有规范整理拼写(例如 `BPC 157` → `BPC-157`);所有需要判断的行都记录在 `scripts/build-supplier-catalog.ts` 的 `decisions` 表里,并输出到对照报告,方便复核或推翻。

## 一次完整更新的步骤

```sh
export PATH=/opt/homebrew/opt/node@24/bin:$PATH   # 需要 Node 24

# 1. 提取 Excel → src/data/supplier-price-list.json(A:C + H + I 备注,处理合并单元格)
npm run catalog:extract                            # 默认读取 ~/Desktop/Price_List.xlsx

# 2. 生成目录 → src/data/supplier-catalog.json + output/supplier-catalog-reconciliation.json
npm run catalog:build
#    先看 reconciliation:added / retired / renamed / retitled / flags / priceChanges

# 3. 生成缺失或改名后的商品图(读取 supplier-catalog.json 的标题和规格)
DATABASE_URL='<本地库连接串>' npm run assets:products

# 4. 数据一致性测试(每行恰好一次、价格等于 H 列、图片存在、分类合法)
npx vitest run src/data/supplier-catalog.test.ts

# 5. 生成 SQL(不写库):output/supplier-catalog-sync.sql
npm run catalog:sync

# 6. 在生产库的本地副本上演练(强烈建议)
#    docker run -d --name ti-shop-pricelist-pg -p 127.0.0.1:5435:5432 -e POSTGRES_PASSWORD=scratch -e POSTGRES_DB=ti_shop postgres:17-alpine
#    ssh hpe1 'cd ~/flintmarrow && docker compose exec -T db pg_dump -U postgres -d ti_shop -Fc --no-owner --no-acl' > /tmp/prod.dump
#    docker cp /tmp/prod.dump ti-shop-pricelist-pg:/tmp/ && docker exec ti-shop-pricelist-pg pg_restore -U postgres -d ti_shop --no-owner --no-acl /tmp/prod.dump
DATABASE_URL='postgresql://postgres:scratch@127.0.0.1:5435/ti_shop?schema=app' \
DIRECT_URL='postgresql://postgres:scratch@127.0.0.1:5435/ti_shop?schema=app' \
npm run catalog:sync -- --apply                   # 执行 + 自动校验,可重复执行(幂等)
```

## 上线(hpe1)

先提交并部署代码(新图片在 `public/products/` 里,必须随镜像发布),再用同一份 SQL 改库:

```sh
git push origin main
ssh hpe1 'cd ~/flintmarrow && git pull && docker compose build app && docker compose up -d'

# 备份后在一个事务里执行
ssh hpe1 'cd ~/flintmarrow && ./backup-db.sh'    # 或 docker compose exec -T db pg_dump ...
scp output/supplier-catalog-sync.sql hpe1:/tmp/
ssh hpe1 'cd ~/flintmarrow && docker compose exec -T db psql -U postgres -d ti_shop -v ON_ERROR_STOP=1 -f - < /tmp/supplier-catalog-sync.sql'

# 校验线上结果
npm run catalog:sync -- --verify-sql > /tmp/verify.sql
ssh hpe1 'cd ~/flintmarrow && docker compose exec -T db psql -U postgres -d ti_shop -At -f -' < /tmp/verify.sql > /tmp/prod-catalog.json
npm run catalog:sync -- --verify-json /tmp/prod-catalog.json
```

SQL 脚本自带断言:活跃商品数必须等于目录条数,每个活跃商品必须恰好一个规格、一条有效 USD 价、一张主图和一个分类,否则整个事务回滚。

## 同步脚本会做什么

- 按 slug upsert 商品(标题、副标题「X per vial, 10 vials/box」、描述含产品编号、`legacy_metadata.supplierPriceList` 记录来源行与价格)。
- 已有商品保留原分类;新商品按 `src/data/product-category-taxonomy.ts` 分类。
- 每个商品一个 `Default` 规格,`price_mode = fixed`;缺货行(I 列 "Temporarily out of stock")把 `track_inventory` 设为 true,前台显示 Temporarily unavailable。
- 需要改 slug 的商品(目前只有 Sermorelin/SMO 让出 `sermorelin-acetate-*` 给新增的 Sermorelin Acetate/SML)先改名再 upsert,主图重新指向新文件;不写 301,因为旧 URL 继续展示同名商品。
- 表里没有的活跃商品改为 `archived`(不删除,订单历史不受影响),其首页推荐位停用。
- 不改动 WhatsApp 配置、成本(reference cost)、订单、用户。

## 不要做的事

- 不要手工改 `src/data/supplier-catalog.json`;改 Excel 或 `decisions` 后重新生成。
- 不要重新导入 `src/data/products.json`(`db:import:legacy` 是旧目录,只用于保留 slug/图片)。
- 收款信息不进代码;价格表 I 列的「仅接受加密货币付款」等条款需要用户决定是否展示。
