
export const M=(()=>{
  const uid=()=>globalThis.crypto?.randomUUID?.()||
    Date.now().toString(36)+Math.random().toString(36).slice(2);

  const cats=[
    ['sales','Vendas de produtos','gross',
      'Receita de produtos vendidos no mês de competência.'],
    ['services','Serviços prestados','gross',
      'Serviços realizados no período, mesmo se o recebimento ocorrer depois.'],
    ['deductions','Impostos sobre vendas, devoluções e descontos','deductions',
      'Valores que reduzem a receita. Lance tributos apurados sem duplicá-los em outras categorias.'],
    ['cost','Custo das vendas e serviços','cost',
      'Custo dos itens vendidos ou dos serviços prestados. Compras ainda em estoque ficam fora da DRE.'],
    ['personnel','Pessoal e encargos','opex',
      'Salários, pró-labore e encargos administrativos. Custos diretos já classificados não devem ser duplicados.'],
    ['admin','Despesas administrativas','opex',
      'Contabilidade, sistemas, materiais e despesas administrativas.'],
    ['commercial','Vendas e marketing','opex',
      'Comissões, publicidade e demais despesas comerciais.'],
    ['structure','Aluguel e estrutura','opex',
      'Aluguel, energia, internet e despesas de estrutura.'],
    ['otherExpense','Outras despesas operacionais','opex',
      'Outras despesas necessárias à operação.'],
    ['depreciation','Depreciação e amortização','depreciation',
      'Despesa do período pelo uso de ativos; não é o valor integral de compra.'],
    ['otherIncome','Outras receitas operacionais','otherIncome',
      'Outras receitas ligadas à operação.'],
    ['financialIncome','Receitas financeiras','financialIncome',
      'Juros e rendimentos. Empréstimos recebidos não são receitas.'],
    ['financialExpense','Despesas financeiras','financialExpense',
      'Juros, tarifas e encargos. Amortização do principal fica fora da DRE.'],
    ['taxes','IRPJ e CSLL','taxes',
      'Tributos sobre o lucro, quando aplicáveis. Informe os valores apurados, evitando duplicação com tributos sobre vendas.'],
    ['capital','Aporte de capital','outside',
      'Entrada patrimonial; não é receita.'],
    ['loan','Empréstimo recebido','outside',
      'Entrada com obrigação de devolução; não é receita.'],
    ['principal','Amortização do principal de dívida','outside',
      'Devolução do principal; somente juros e encargos afetam a DRE.'],
    ['assets','Compra de ativo','outside',
      'Compra de equipamento ou outro ativo; depreciação entra separadamente.'],
    ['inventory','Compra de estoque','outside',
      'O custo entra na DRE quando os itens são vendidos.'],
    ['distribution','Distribuição de lucros','outside',
      'Retirada pelos sócios; não é despesa operacional.']
  ].map(([id,name,group,hint])=>({id,name,group,hint}));

  const map=Object.fromEntries(cats.map(c=>[c.id,c]));
  const monthValid=m=>typeof m==='string'&&
    /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(m);

  function dateValid(v){
    if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||
      !monthValid(v.slice(0,7)))return false;
    const d=new Date(v+'T12:00:00Z');
    return !isNaN(d)&&d.toISOString().slice(0,10)===v;
  }

  function cents(text){
    let s=String(text).trim().replace(/^R\$\s*/,'').replace(/\s/g,'');
    if(/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(s)){
      s=s.replace(/\./g,'').replace(',','.');
    }else if(!/^\d+\.\d{1,2}$/.test(s)){
      throw Error('Informe um valor como 1.250,50, maior que zero.');
    }
    const a=s.split('.');
    const n=Number(a[0])*100+Number((a[1]||'').padEnd(2,'0'));
    if(!Number.isSafeInteger(n)||n<=0||n>1e12)
      throw Error('Valor inválido ou acima de R$ 10 bilhões.');
    return n;
  }

  const empty=()=>({version:1,companies:[],entries:[]});

  function validate(d){
    if(!d||d.version!==1||!Array.isArray(d.companies)||
      !Array.isArray(d.entries)||d.companies.length>1000||
      d.entries.length>50000)throw Error('Backup inválido ou muito grande.');

    const ids=new Set(),entries=new Set();
    let sum=0;

    for(const c of d.companies){
      if(!c||typeof c.id!=='string'||!c.id||ids.has(c.id)||
        typeof c.name!=='string'||!c.name.trim()||c.name.length>80||
        typeof c.sector!=='string'||c.sector.length>80)
        throw Error('Empresa inválida no backup.');
      ids.add(c.id);
    }

    for(const e of d.entries){
      if(!e||typeof e.id!=='string'||!e.id||entries.has(e.id)||
        !ids.has(e.company)||!Object.hasOwn(map,e.category)||!dateValid(e.date)||
        typeof e.description!=='string'||!e.description.trim()||
        e.description.length>180||!Number.isSafeInteger(e.amount)||
        e.amount<=0||e.amount>1e12)
        throw Error('Lançamento inválido no backup.');

      entries.add(e.id);
      sum+=e.amount;
      if(sum>Number.MAX_SAFE_INTEGER/4)
        throw Error('Valores acima do limite de cálculo seguro.');
    }
    return d;
  }

  function shift(m,n){
    const d=new Date(+m.slice(0,4),+m.slice(5)-1+n,1,12);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
  }

  function selected(d,company,month,ytd=false){
    return d.entries.filter(e=>
      (company==='all'||e.company===company)&&
      e.date.slice(0,7)>=(ytd?month.slice(0,4)+'-01':month)&&
      e.date.slice(0,7)<=month);
  }

  function report(d,company,month,ytd=false){
    const t={
      gross:0,deductions:0,cost:0,opex:0,depreciation:0,
      otherIncome:0,financialIncome:0,financialExpense:0,taxes:0,outside:0
    };
    const detail=Object.fromEntries(cats.map(c=>[c.id,0]));
    let count=0,outsideCount=0;

    for(const e of selected(d,company,month,ytd)){
      const group=map[e.category].group;
      t[group]+=e.amount;
      detail[e.category]+=e.amount;
      if(group==='outside')outsideCount++;
      else count++;
    }

    const netRevenue=t.gross-t.deductions;
    const grossProfit=netRevenue-t.cost;
    const operating=grossProfit+t.otherIncome-t.opex-t.depreciation;
    const financial=t.financialIncome-t.financialExpense;
    const beforeTaxes=operating+financial;
    const profit=beforeTaxes-t.taxes;
    const expenses=t.cost+t.opex+t.depreciation+t.financialExpense+t.taxes;

    return {
      ...t,detail,netRevenue,grossProfit,operating,financial,
      beforeTaxes,profit,expenses,
      margin:netRevenue>0?profit/netRevenue*100:null,count,outsideCount
    };
  }

  function rows(r,detail=true){
    const out=[];
    const add=(label,value,kind='section',group)=>{
      out.push({label,value,kind});
      if(detail&&group){
        for(const c of cats.filter(c=>c.group===group)){
          out.push({
            label:c.name,
            value:r.detail[c.id]*
              (['gross','otherIncome','financialIncome'].includes(group)?1:-1),
            kind:'detail'
          });
        }
      }
    };
    add('Receita bruta',r.gross,'section','gross');
    add('Deduções da receita',-r.deductions);
    add('Receita líquida',r.netRevenue,'subtotal');
    add('Custo das vendas e serviços',-r.cost);
    add('Lucro bruto',r.grossProfit,'subtotal');
    add('Outras receitas operacionais',r.otherIncome);
    add('Despesas operacionais',-r.opex,'section','opex');
    add('Depreciação e amortização',-r.depreciation);
    add('Resultado operacional',r.operating,'subtotal');
    add('Receitas financeiras',r.financialIncome);
    add('Despesas financeiras',-r.financialExpense);
    add('Resultado financeiro',r.financial,'subtotal');
    add('Resultado antes de IRPJ e CSLL',r.beforeTaxes,'subtotal');
    add('IRPJ e CSLL',-r.taxes);
    add('Lucro / prejuízo líquido',r.profit,'final');
    return out;
  }

  function demo(month){
    const d=empty();
    d.companies=[
      {id:'a',name:'Aurora Comércio',sector:'Comércio varejista'},
      {id:'b',name:'Studio Norte',sector:'Serviços e design'},
      {id:'c',name:'Café do Pátio',sector:'Alimentação'}
    ];
    const values=[
      {
        sales:148000,services:4000,deductions:13600,cost:67600,
        personnel:18400,admin:4260,commercial:6800,structure:7200,
        otherExpense:1400,depreciation:1800,financialIncome:620,
        financialExpense:1280,taxes:2250
      },
      {
        services:86000,deductions:5160,cost:22500,personnel:21000,
        admin:3900,commercial:3200,structure:4600,depreciation:1200,
        financialIncome:320,financialExpense:450,taxes:1100
      },
      {
        sales:52500,deductions:3150,cost:21400,personnel:18600,
        admin:2600,commercial:1800,structure:8500,otherExpense:1600,
        depreciation:900,financialExpense:750
      }
    ];

    for(let i=-5;i<=0;i++){
      d.companies.forEach((c,k)=>{
        Object.entries(values[k]).forEach(([category,n],j)=>{
          const factor=1+i*(map[category].group==='gross'?0.035:0.008);
          d.entries.push({
            id:uid(),company:c.id,
            date:shift(month,i)+'-'+String(5+j).padStart(2,'0'),
            category,description:map[category].name+' · exemplo',
            amount:Math.round(n*factor)*100
          });
        });
      });
    }

    d.entries.push({
      id:uid(),company:'a',date:month+'-05',category:'loan',
      description:'Capital de giro · exemplo',amount:2000000
    });
    return validate(d);
  }

  return {
    uid,cats,map,cents,empty,validate,shift,
    monthValid,dateValid,selected,report,rows,demo
  };
})();
