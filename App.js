import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, RefreshControl, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { api, getRouterConfig, setRouterConfig } from './src/api';

const C = { bg:'#030a19', panel:'#08172d', panel2:'#0b2040', line:'#17345e', text:'#eaf2ff', muted:'#8295b5', blue:'#1684ff', cyan:'#12c9ed', green:'#12d99a', red:'#ff5374', purple:'#8c5cff', amber:'#ffc45e' };
const DASH = '\u2014';
const TABS = [{id:'home',label:'Dashboard',icon:'home'},{id:'ppp',label:'PPP',icon:'users'},{id:'hotspot',label:'Hotspot',icon:'hotspot'},{id:'router',label:'Router',icon:'router'},{id:'settings',label:'Settings',icon:'settings'}];
const ICONS = {home:'view-dashboard-outline',users:'account-multiple-outline',user:'account-outline',hotspot:'wifi',router:'router-wireless',settings:'cog-outline',clock:'clock-outline',cpu:'cpu-64-bit',memory:'memory',voucher:'ticket-confirmation-outline',search:'magnify',interface:'lan-connect',backend:'server-network-outline',bell:'bell-outline',info:'information-outline',theme:'moon-waning-crescent',logout:'logout',edit:'pencil-outline',delete:'trash-can-outline',close:'close'};
const EMPTY = { dashboard:{},secrets:[],active:[],profiles:[],services:[],hotspotUsers:[],hotspotActive:[],hotspotProfiles:[],interfaces:[] };

function Button({title,onPress,kind='primary',disabled=false,compact=false}) { return <Pressable onPress={onPress} disabled={disabled} style={[styles.button,kind==='secondary'&&styles.secondaryButton,kind==='danger'&&styles.dangerButton,compact&&styles.compactButton,disabled&&styles.disabled]}><Text style={styles.buttonText}>{title}</Text></Pressable>; }
function Card({children,style,onPress}) { const Container=onPress?Pressable:View;return <Container onPress={onPress} style={[styles.card,style]}>{children}</Container>; }
function Field({label,value,onChangeText,placeholder='',secure=false,keyboardType='default',multiline=false}) { return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={C.muted} secureTextEntry={secure} keyboardType={keyboardType} autoCapitalize="none" multiline={multiline} textAlignVertical={multiline?'top':'center'} style={[styles.input,multiline&&styles.multilineInput]}/></View>; }
function SectionTitle({title,action,onAction}) { return <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{title}</Text>{action?<Pressable onPress={onAction}><Text style={styles.link}>{action}</Text></Pressable>:null}</View>; }
function Chip({label,selected,onPress,tone=C.blue}) { return <Pressable onPress={onPress} style={[styles.chip,selected&&{backgroundColor:tone,borderColor:tone}]}><Text style={[styles.chipText,selected&&styles.selectedChipText]}>{label}</Text></Pressable>; }
function Dropdown({label,value,options,onChange,placeholder='Pilih...'}) {
  const [open,setOpen]=useState(false);
  return <View style={[styles.field,open&&styles.dropdownFieldOpen]}><Text style={styles.label}>{label}</Text><Pressable accessibilityRole="button" accessibilityState={{expanded:open}} onPress={()=>setOpen(current=>!current)} style={styles.dropdown}><Text numberOfLines={1} style={[styles.dropdownValue,!value&&styles.dropdownPlaceholder]}>{value||placeholder}</Text><MaterialCommunityIcons name={open?'chevron-up':'chevron-down'} color={C.muted} size={18}/></Pressable>{open?<ScrollView style={styles.dropdownOptions} nestedScrollEnabled keyboardShouldPersistTaps="handled">{options.map(option=>{const key=String(option.value),selected=key===String(value);return <Pressable key={key} onPress={()=>{onChange(option.value);setOpen(false);}} style={[styles.dropdownOption,selected&&styles.dropdownOptionSelected]}><Text style={[styles.dropdownOptionText,selected&&styles.dropdownOptionTextSelected]}>{option.label}</Text>{selected?<MaterialCommunityIcons name="check" color={C.cyan} size={16}/>:null}</Pressable>;})}{!options.length?<Text style={styles.dropdownEmpty}>Pilihan belum tersedia.</Text>:null}</ScrollView>:null}</View>;
}
function Pill({children,tone=C.green}) { return <View style={[styles.pill,{backgroundColor:`${tone}22`,borderColor:`${tone}55`}]}><View style={[styles.pillDot,{backgroundColor:tone}]}/><Text style={[styles.pillText,{color:tone}]}>{children}</Text></View>; }
function StatCard({label,value,sub,icon,tone=C.blue,onPress,compactValue=false}) { return <Pressable disabled={!onPress} onPress={onPress} style={styles.statCard}><View style={[styles.statGlyph,{backgroundColor:`${tone}24`}]}><AppIcon name={icon} color={tone} size={16}/></View><Text style={styles.statLabel}>{label}</Text><Text style={[styles.statValue,compactValue&&styles.statValueCompact]}>{value===null||value===undefined||value===''?DASH:compactValue?formatUptime(value):String(value)}</Text>{sub?<Text style={styles.statSub}>{sub}</Text>:null}</Pressable>; }
function ScreenHeader({title,subtitle,right}) { return <View style={styles.screenHeader}><View style={{flex:1}}><Text style={styles.screenTitle}>{title}</Text>{subtitle?<Text style={styles.screenSubtitle}>{subtitle}</Text>:null}</View>{right||null}</View>; }
function EmptyState({title,detail,loading=false}) { return <View style={styles.emptyState}>{loading?<ActivityIndicator color={C.blue}/>:<View style={styles.emptyGlyph}><AppIcon name="info" color={C.cyan} size={20}/></View>}<Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyDetail}>{detail}</Text></View>; }
function AppIcon({name,color=C.cyan,size=18}) { return <MaterialCommunityIcons name={ICONS[name]||'help-circle-outline'} color={color} size={size}/>; }
function DetailLine({label,value}) { return <View style={detailStyles.detailLine}><Text style={detailStyles.detailLabel}>{label}</Text><Text numberOfLines={2} style={detailStyles.detailValue}>{value||DASH}</Text></View>; }
function RecordDetailPopup({record,onClose,onEdit,onDelete,onToggleInterface,interfaceBusy}) {
  if(!record)return null;
  const {type,item}=record,isPpp=type==='ppp',isInterface=type==='interface';
  return <View style={detailStyles.overlay}><Pressable style={StyleSheet.absoluteFill} onPress={onClose}/><View style={detailStyles.popup}><View style={detailStyles.header}><View style={{flex:1}}><Text style={detailStyles.heading}>{isInterface?'Detail Interface':isPpp?'Detail Akun PPPoE':'Detail Voucher Hotspot'}</Text><Text style={detailStyles.name}>{item.name||item.user||'—'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Tutup detail" onPress={onClose} hitSlop={10} style={detailStyles.close}><AppIcon name="close" color={C.muted} size={22}/></Pressable></View><View style={detailStyles.info}>{isInterface?<><DetailLine label="Tipe" value={item.type}/><DetailLine label="Status" value={item.disabled==='true'?'Disabled':'Enabled'}/><DetailLine label="Status link" value={item.running==='true'?'Connected':'Tidak terhubung'}/><DetailLine label="MAC address" value={item['mac-address']}/><DetailLine label="MTU" value={item.mtu}/><DetailLine label="Comment" value={item.comment}/></>:isPpp?<><DetailLine label="Profil" value={item.profile}/><DetailLine label="Service" value={item.service}/><DetailLine label="Local address" value={item['local-address']}/><DetailLine label="Remote address" value={item['remote-address']}/><DetailLine label="Komentar" value={item.comment}/></>:<><DetailLine label="Profil" value={item.profile}/><DetailLine label="Durasi" value={item['limit-uptime']}/><DetailLine label="Server" value={item.server}/><DetailLine label="Komentar" value={item.comment}/><DetailLine label="Status" value={item.disabled==='true'?'Nonaktif':'Tersedia'}/></>}</View>{isInterface?<View style={detailStyles.interfaceActions}>{item.running!=='true'?<Pressable accessibilityRole="button" accessibilityLabel="Enable interface" onPress={()=>onToggleInterface(item,true)} disabled={interfaceBusy} style={[detailStyles.interfaceAction,detailStyles.enableAction,interfaceBusy&&detailStyles.actionDisabled]}><Text style={detailStyles.interfaceActionText}>{interfaceBusy?'Memproses...':'Enable'}</Text></Pressable>:null}<Pressable accessibilityRole="button" accessibilityLabel="Disable interface" onPress={()=>onToggleInterface(item,false)} disabled={interfaceBusy} style={[detailStyles.interfaceAction,detailStyles.disableAction,interfaceBusy&&detailStyles.actionDisabled]}><Text style={detailStyles.interfaceActionText}>{interfaceBusy?'Memproses...':'Disable'}</Text></Pressable></View>:<View style={detailStyles.actions}><Pressable accessibilityRole="button" accessibilityLabel="Edit" onPress={onEdit} hitSlop={10} style={detailStyles.action}><AppIcon name="edit" color={C.green} size={23}/></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Hapus" onPress={onDelete} hitSlop={10} style={detailStyles.action}><AppIcon name="delete" color={C.red} size={23}/></Pressable></View>}</View></View>;
}
function TabGlyph({name,active,tone,raised=false}) { return <View style={[styles.tabGlyph,raised&&{transform:[{translateY:-6}]}]}><AppIcon name={name} color={active?tone:C.muted} size={raised?23:20}/></View>; }
function SettingItem({icon,title,subtitle,onPress,tone=C.blue,last=false}) { return <Pressable onPress={onPress} style={[styles.settingMenuItem,!last&&styles.settingMenuDivider]}><View style={[styles.settingMenuIcon,{backgroundColor:`${tone}24`}]}><AppIcon name={icon} color={tone} size={17}/></View><View style={{flex:1}}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.cardSubtitle}>{subtitle}</Text></View><MaterialCommunityIcons name="chevron-right" color={C.muted} size={19}/></Pressable>; }
function TrafficChart({history}) {
  const values=history.slice(-300);
  const peak=Math.max(1,...values.flatMap(point=>[Number(point.rx)||0,Number(point.tx)||0]));
  const magnitude=10**Math.floor(Math.log10(peak));
  const normalized=peak/magnitude;
  const max=(normalized<=1?1:normalized<=2?2:normalized<=5?5:10)*magnitude;
  const plotRef=useRef(null);
  useEffect(()=>{
    if(Platform.OS!=='web'||!plotRef.current||values.length<2)return;
    const canvas=plotRef.current,ctx=canvas.getContext('2d');
    const draw=()=>{
      const width=canvas.clientWidth,height=canvas.clientHeight,ratio=window.devicePixelRatio||1;
      if(!width||!height)return;
      canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
      ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
      [['rx',C.cyan],['tx',C.purple]].forEach(([key,color])=>{
        const pts=values.map((point,index)=>{
          const x=index/(values.length-1)*width;
          const actual=Math.min(1,Math.max(0,(Number(point[key])||0)/max));
          const y=height-3-actual*(height-8);
          return {x,y};
        });
        ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
        for(let i=1;i<pts.length;i++){const prev=pts[i-1],cur=pts[i],midX=(prev.x+cur.x)/2;ctx.quadraticCurveTo(midX,prev.y,midX,(prev.y+cur.y)/2);ctx.quadraticCurveTo(midX,cur.y,cur.x,cur.y);}
        ctx.save();ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.lineJoin='round';ctx.lineCap='round';ctx.shadowColor=color;ctx.shadowBlur=6;ctx.globalAlpha=.2;ctx.stroke();ctx.restore();
        ctx.save();ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.lineJoin='round';ctx.lineCap='round';ctx.shadowColor=color;ctx.shadowBlur=2;ctx.stroke();ctx.restore();
      });
    };
    draw();
    const observer=new ResizeObserver(draw);observer.observe(canvas);
    return()=>observer.disconnect();
  },[history,max]);
  return <View style={styles.chartWrap}><View style={styles.chartAxis}>{[max,max*.75,max*.5,max*.25,0].map((rate,index)=><View key={index} style={styles.axisRow}><Text style={styles.axisLabel}>{formatRate(rate)}</Text><View style={[styles.axisLine,index===4&&styles.axisBaseline]}/></View>)}</View><View style={styles.chart}>{Platform.OS==='web'&&values.length>1?<canvas ref={plotRef} style={{width:'100%',height:'100%',display:'block'}}/>:<Text style={styles.chartEmpty}>Menunggu sampel trafik router</Text>}</View></View>;
}
function ConnectionScreen({form,setForm,error,busy,onConnect}) {
  return <SafeAreaView style={[styles.safe,{flex:1,minHeight:0}]}><ExpoStatusBar style="light"/><StatusBar barStyle="light-content" backgroundColor={C.bg}/><View style={styles.brandHeader}><View style={styles.logo}><Text style={styles.logoText}>M</Text></View><View><Text style={styles.brand}>NetWatch Mon</Text><Text style={styles.brandSubtitle}>MIKROTIK MANAGEMENT</Text></View></View><ScrollView contentContainerStyle={styles.pageContent} keyboardShouldPersistTaps="handled"><Text style={styles.overline}>KONEKSI MIKROTIK</Text><Text style={styles.screenTitle}>Hubungkan router</Text><Text style={[styles.screenSubtitle,{marginBottom:18}]}>Masukkan alamat dan akun API MikroTik untuk menghubungkan router.</Text>{error?<Card style={styles.errorCard}><Text style={styles.errorText}>{error}</Text></Card>:null}<Card><Field label="IP ADDRESS / HOST" value={form.host} onChangeText={host=>setForm(current=>({...current,host}))} placeholder="192.168.2.1 atau router.example.com"/><Field label="API PORT" value={form.apiPort} onChangeText={apiPort=>setForm(current=>({...current,apiPort}))} placeholder="8728" keyboardType="number-pad"/><Pressable accessibilityRole="checkbox" accessibilityState={{checked:Boolean(form.apiSsl)}} onPress={()=>setForm(current=>({...current,apiSsl:!current.apiSsl}))} style={{flexDirection:'row',alignItems:'center',gap:8,marginBottom:11}}><MaterialCommunityIcons name={form.apiSsl?'checkbox-marked':'checkbox-blank-outline'} color={form.apiSsl?C.cyan:C.muted} size={20}/><Text style={styles.cardSubtitle}>Gunakan API-SSL (sertifikat router harus valid)</Text></Pressable><Field label="USERNAME" value={form.username} onChangeText={username=>setForm(current=>({...current,username}))} placeholder="Username API MikroTik"/><Field label="PASSWORD" value={form.password} onChangeText={password=>setForm(current=>({...current,password}))} placeholder="Password API MikroTik" secure/><Button title={busy?'Menghubungkan...':'Hubungkan dan buka dashboard'} disabled={busy||!form.host.trim()||!form.apiPort||!form.username.trim()||!form.password} onPress={onConnect}/></Card></ScrollView></SafeAreaView>;
}

export default function App() {
  const [tab,setTab]=useState('home');
  const [routerId,setRouterId]=useState('');
  const [routerStage,setRouterStage]=useState(true);
  const [routerForm,setRouterForm]=useState({host:'',apiPort:'8728',username:'',password:'',apiSsl:false});
  const [routers,setRouters]=useState([]);
  const [routerBusy,setRouterBusy]=useState(false);
  const [routerReady,setRouterReady]=useState(false);
  const [data,setData]=useState(EMPTY);
  const [trafficHistory,setTrafficHistory]=useState([]);
  const [loading,setLoading]=useState(false);
  const [refreshing,setRefreshing]=useState(false);
  const [error,setError]=useState('');
  const [notificationsEnabled,setNotificationsEnabled]=useState(true);
  const [pppView,setPppView]=useState('users');
  const [pppFilter,setPppFilter]=useState('all');
  const [hotspotView,setHotspotView]=useState('vouchers');
  const [search,setSearch]=useState('');
  const [pppForm,setPppForm]=useState({name:'',password:'',service:'pppoe',profile:'',localAddress:'',remoteAddress:'',comment:''});
  const [pppEditId,setPppEditId]=useState(null);
  const [hotspotEditForm,setHotspotEditForm]=useState({id:'',name:'',password:'',profile:'',duration:'',comment:''});
  const [detailItem,setDetailItem]=useState(null);
  const [interfaceBusy,setInterfaceBusy]=useState(false);
  const [voucherForm,setVoucherForm]=useState({count:'',duration:'',profile:''});
  const [generatedVouchers,setGeneratedVouchers]=useState([]);
  const [saving,setSaving]=useState(false);
  const dashboardRequest=useRef(null);
  const routerGeneration=useRef(0);

  useEffect(()=>{
    let active=true;
    (async()=>{
      try {
        const saved=await getRouterConfig();
        if(active&&saved?.host){
          const apiPort=saved.apiPort||saved.api_port||10453;
          setRouterForm({host:saved.host,apiPort:String(apiPort),username:saved.username||'',password:saved.password||'',apiSsl:Boolean(saved.apiSsl)});
          setRouters([{id:'local-router',name:saved.name||'MikroTik',host:saved.host,apiPort}]);
        }
      } catch(e) { if(active)setError('Konfigurasi router lokal tidak dapat dibaca. Silakan isi kembali.'); }
      finally { if(active){setRouterReady(true);if(Platform.OS==='web')window.history.replaceState({},'','/connection');} }
    })();
    return()=>{active=false;};
  },[]);

  const fetchDashboard=useCallback(()=>{
    if(dashboardRequest.current)return dashboardRequest.current;
    const generation=routerGeneration.current;
    const request=(async()=>{
      const dashboard=await api('/api/dashboard',{timeoutMs:30000});
      if(generation!==routerGeneration.current)return dashboard;
      setData(current=>({...current,dashboard,interfaces:Array.isArray(dashboard.interfaces)?dashboard.interfaces:current.interfaces}));
      setError('');
      return dashboard;
    })();
    dashboardRequest.current=request;
    return request.finally(()=>{if(dashboardRequest.current===request)dashboardRequest.current=null;});
  },[]);

  const fetchTraffic=useCallback(async()=>{
    const traffic=await api('/api/traffic',{timeoutMs:10000});
    setData(current=>({...current,dashboard:{...current.dashboard,traffic:{rx:traffic.rx,tx:traffic.tx,ready:traffic.ready},activeInterfaces:traffic.activeInterfaces}}));
    if(traffic.ready)setTrafficHistory(current=>[...current.slice(-299),traffic]);
    return traffic;
  },[]);

  const loadData=useCallback(async(section=tab,quiet=false)=>{
    if(!routerId)return;
    if(quiet)setRefreshing(true);else setLoading(true);
    setError('');
    try {
      if(section==='home') {
        await fetchDashboard();
      } else if(section==='ppp') {
        const [secrets,active,profiles,config]=await Promise.all([api('/api/ppp/secrets'),api('/api/ppp/active'),api('/api/ppp/profiles'),api('/api/config')]);
        setData(current=>({...current,secrets,active,profiles,services:config.pppServices||[]}));
        setPppForm(current=>({...current,profile:current.profile||profiles[0]?.name||''}));
      } else if(section==='hotspot') {
        const [hotspotUsers,hotspotActive,hotspotProfiles]=await Promise.all([api('/api/hotspot/users'),api('/api/hotspot/active'),api('/api/hotspot/profiles')]);
        setData(current=>({...current,hotspotUsers,hotspotActive,hotspotProfiles}));
        setVoucherForm(current=>({...current,profile:current.profile||hotspotProfiles[0]?.name||''}));
      } else if(section==='router') {
        await fetchDashboard();
      } else if(section==='settings')return;
    } catch(e) {
      setError(e.message||'Gagal memuat data router.');
    } finally {setLoading(false);setRefreshing(false);}
  },[routerId,tab,fetchDashboard]);

  useEffect(()=>{if(routerId&&!routerStage)loadData(tab);},[routerId,routerStage,tab,loadData]);
  useEffect(()=>{
    if(!routerId||routerStage||tab!=='home')return;
    let timer,cancelled=false;
    const poll=async()=>{
      try{await fetchDashboard();}
      catch(e){setError(e.message||'Gagal memuat data router.');}
      finally{if(!cancelled)timer=setTimeout(poll,5000);}
    };
    timer=setTimeout(poll,5000);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[routerId,routerStage,tab,fetchDashboard]);
  useEffect(()=>{
    if(!routerId||routerStage||tab!=='home')return;
    let timer,cancelled=false;
    const poll=async()=>{
      try{await fetchTraffic();}
      catch(e){setError(e.message||'Gagal memuat trafik router.');}
      finally{if(!cancelled)timer=setTimeout(poll,1000);}
    };
    poll();
    return()=>{cancelled=true;clearTimeout(timer);};
  },[routerId,routerStage,tab,fetchTraffic]);

  const connectRouter=async()=>{
    setRouterBusy(true);setError('');
    try {
      const clean={host:routerForm.host.trim(),apiPort:Number(routerForm.apiPort),username:routerForm.username.trim(),password:routerForm.password,apiSsl:Boolean(routerForm.apiSsl)};
      const result=await api('/api/routers/test',{method:'POST',body:JSON.stringify(clean),skipAuth:true,skipRouterConfig:true,headers:{'x-router-config':encodeURIComponent(JSON.stringify(clean))}});
      const saved={...clean,name:result.identity||'MikroTik'};
      await setRouterConfig(saved);
      routerGeneration.current+=1;dashboardRequest.current=null;
      setRouterId('local-router');setRouters([{id:'local-router',name:saved.name,host:saved.host,apiPort:saved.apiPort}]);
      setData(current=>({...current,dashboard:{},interfaces:[]}));
      setRouterForm({...saved,apiPort:String(saved.apiPort)});
      setRouterStage(false);setTab('home');
      if(Platform.OS==='web')window.history.replaceState({},'','/');
    } catch(e){setError(e.message||'Gagal menghubungkan router.');}
    finally{setRouterBusy(false);}
  };
  const openConnection=()=>{setError('');setRouterStage(true);if(Platform.OS==='web')window.history.replaceState({},'','/connection');};
  const disconnectRouter=()=>Alert.alert('Putuskan router?','Konfigurasi koneksi router akan dihapus dari perangkat ini.',[{text:'Batal',style:'cancel'},{text:'Putuskan',style:'destructive',onPress:async()=>{
    try{
      await setRouterConfig(null);
      routerGeneration.current+=1;dashboardRequest.current=null;
      setRouterId('');setRouters([]);setData(EMPTY);setTrafficHistory([]);setDetailItem(null);setError('');setTab('home');
      setRouterForm({host:'',apiPort:'8728',username:'',password:'',apiSsl:false});
      setRouterStage(true);
      if(Platform.OS==='web')window.history.replaceState({},'','/connection');
    }catch(e){Alert.alert('Gagal memutuskan router',e.message||'Konfigurasi router tidak dapat dihapus.');}
  }}]);
  const refresh=()=>loadData(tab,true);
  const activeNames=useMemo(()=>new Set(data.active.map(item=>item.name)),[data.active]);
  const visibleSecrets=useMemo(()=>data.secrets.filter(item=>{
    const active=activeNames.has(item.name);
    const filterMatches=pppFilter==='all'||(pppFilter==='active'?active:!active);
    const searchMatches=`${item.name||''} ${item.profile||''} ${item.service||''}`.toLowerCase().includes(search.toLowerCase());
    return filterMatches&&searchMatches;
  }),[data.secrets,activeNames,pppFilter,search]);
  const visibleActive=useMemo(()=>data.active.filter(item=>`${item.name||''} ${item.address||''} ${item['caller-id']||''}`.toLowerCase().includes(search.toLowerCase())),[data.active,search]);

  const savePpp=async()=>{
    if(!pppForm.name.trim()||(!pppEditId&&!pppForm.password)||!pppForm.profile)return Alert.alert('Data belum lengkap','Username, password, dan profil wajib diisi.');
    setSaving(true);
    try{await api(pppEditId?`/api/ppp/secrets/${encodeURIComponent(pppEditId)}`:'/api/ppp/secrets',{method:pppEditId?'PATCH':'POST',body:JSON.stringify(pppForm)});setPppForm({name:'',password:'',service:'pppoe',profile:data.profiles[0]?.name||'',localAddress:'',remoteAddress:'',comment:''});setPppEditId(null);setPppView('users');await loadData('ppp',true);Alert.alert('Berhasil',pppEditId?'Akun PPP diperbarui.':'Akun PPP berhasil ditambahkan.');}
    catch(e){Alert.alert(pppEditId?'Gagal mengubah akun':'Gagal menambah akun',e.message);}finally{setSaving(false);}
  };
  const editPpp=item=>{setPppEditId(item['.id']);setPppForm({name:item.name||'',password:'',service:item.service||'pppoe',profile:item.profile||data.profiles[0]?.name||'',localAddress:item['local-address']||'',remoteAddress:item['remote-address']||'',comment:item.comment||''});setPppView('add');};
  const removePpp=(item)=>Alert.alert('Hapus akun?',`Akun ${item.name} akan dihapus dari MikroTik.`,[{text:'Batal',style:'cancel'},{text:'Hapus',style:'destructive',onPress:async()=>{try{await api(`/api/ppp/secrets/${encodeURIComponent(item['.id'])}`,{method:'DELETE'});await loadData('ppp',true);}catch(e){Alert.alert('Gagal',e.message);}}}]);
  const showPppActions=item=>setDetailItem({type:'ppp',item});
  const disconnectPpp=(item)=>Alert.alert('Putus sesi?',`Sesi ${item.name} akan diputus.`,[{text:'Batal',style:'cancel'},{text:'Putuskan',style:'destructive',onPress:async()=>{try{await api(`/api/ppp/active/${encodeURIComponent(item['.id'])}`,{method:'DELETE'});await loadData('ppp',true);}catch(e){Alert.alert('Gagal',e.message);}}}]);
  const generateVouchers=async()=>{
    const count=Number(voucherForm.count);
    if(!Number.isInteger(count)||count<1||count>100)return Alert.alert('Jumlah tidak valid','Masukkan jumlah voucher dari 1 sampai 100.');
    if(!/^\d+[smhdw]$/.test(voucherForm.duration))return Alert.alert('Durasi tidak valid','Gunakan format angka dengan satuan s, m, h, d, atau w.');
    if(!voucherForm.profile)return Alert.alert('Profil belum dipilih','Pilih profil Hotspot dari MikroTik.');
    setSaving(true);
    try{const result=await api('/api/hotspot/vouchers',{method:'POST',body:JSON.stringify(voucherForm)});setGeneratedVouchers(result.items||[]);setHotspotView('vouchers');await loadData('hotspot',true);Alert.alert('Berhasil',`${(result.items||[]).length} voucher dibuat.`);}
    catch(e){Alert.alert('Gagal membuat voucher',e.message);}finally{setSaving(false);}
  };
  const editVoucher=item=>{setHotspotEditForm({id:item['.id'],name:item.name||'',password:'',profile:item.profile||'',duration:item['limit-uptime']||'',comment:item.comment||''});setHotspotView('edit');};
  const saveVoucher=async()=>{
    if(!hotspotEditForm.name.trim()||!hotspotEditForm.profile)return Alert.alert('Data belum lengkap','Username dan profil voucher wajib diisi.');
    setSaving(true);
    try{const {id,...body}=hotspotEditForm;await api(`/api/hotspot/users/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)});setHotspotView('vouchers');await loadData('hotspot',true);Alert.alert('Berhasil','Voucher diperbarui.');}
    catch(e){Alert.alert('Gagal mengubah voucher',e.message);}finally{setSaving(false);}
  };
  const removeVoucher=item=>Alert.alert('Hapus voucher?',`Voucher ${item.name} akan dihapus dari MikroTik.`,[{text:'Batal',style:'cancel'},{text:'Hapus',style:'destructive',onPress:async()=>{try{await api(`/api/hotspot/users/${encodeURIComponent(item['.id'])}`,{method:'DELETE'});await loadData('hotspot',true);}catch(e){Alert.alert('Gagal menghapus voucher',e.message);}}}]);
  const showVoucherActions=item=>setDetailItem({type:'voucher',item});
  const toggleInterface=(item,enabled)=>Alert.alert(`${enabled?'Aktifkan':'Nonaktifkan'} interface?`,`Interface ${item.name||''} akan ${enabled?'diaktifkan':'dinonaktifkan'} pada router.`,[{text:'Batal',style:'cancel'},{text:enabled?'Aktifkan':'Nonaktifkan',style:enabled?'default':'destructive',onPress:async()=>{
    const id=item['.id'];
    if(!id)return Alert.alert('Gagal','ID interface tidak tersedia.');
    setInterfaceBusy(true);
    try{
      await api(`/api/router/interfaces/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({enabled})});
      const updated={...item,disabled:String(!enabled)};
      setDetailItem(current=>current?.type==='interface'&&current.item['.id']===id?{...current,item:updated}:current);
      await loadData('router',true);
      Alert.alert('Berhasil',`Interface ${enabled?'diaktifkan':'dinonaktifkan'}.`);
    }catch(e){Alert.alert('Gagal mengubah interface',e.message);}finally{setInterfaceBusy(false);}
  }}]);

  const dashboardScreen=()=>{
    const d=data.dashboard;
    return <ScrollView contentContainerStyle={styles.pageContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.blue}/> }>
      {error?<Card style={styles.errorCard}><Text style={styles.errorTitle}>Gagal memuat data router</Text><Text style={styles.errorText}>{error}</Text><Button title="Coba lagi" kind="secondary" onPress={refresh}/></Card>:null}
      <Card style={styles.routerSummary}><View style={styles.routerMark}><AppIcon name="router" color={C.cyan} size={25}/></View><View style={{flex:1}}><View style={styles.inline}><Text style={[styles.routerStatus,error&&{color:C.red}]}>Router {error?'Offline':d.identity?'Online':'Menghubungkan'}</Text>{d.identity&&!error?<View style={styles.onlineDot}/>:null}</View><Text style={styles.routerName}>{d.identity||routers[0]?.name|| (loading?'Memuat data router...':'Data router belum tersedia')}</Text><Text style={styles.routerMeta}>{[d.boardName,d.version,routers[0]?.host].filter(Boolean).join('  ·  ')||DASH}</Text></View><Text style={styles.tag}>{d.version||DASH}</Text></Card>
      <View style={styles.statsGrid}>
        <StatCard label="PPP Aktif" value={d.active} sub={d.totalSecrets===undefined?undefined:`/ ${d.totalSecrets}`} icon="users" tone={C.purple} onPress={()=>{setPppView('active');setTab('ppp');}}/>
        <StatCard label="Total Secret" value={d.totalSecrets} icon="user" tone={C.blue} onPress={()=>setTab('ppp')}/>
        <StatCard label="Hotspot Aktif" value={d.activeHotspot} sub="terhubung" icon="voucher" tone={C.cyan} onPress={()=>{setHotspotView('vouchers');setTab('hotspot');}}/>
        <StatCard label="Uptime" value={d.uptime} sub="router aktif" icon="clock" tone={C.purple} compactValue/>
      </View>
      <Card style={styles.trafficCard}><View style={styles.rowBetween}><View><Text style={styles.cardTitle}>Trafik Realtime</Text><Text style={styles.cardSubtitle}>{d.activeInterfaces??DASH} interface aktif</Text></View><Pill tone={d.traffic?.ready?C.green:C.muted}>{d.traffic?.ready?'Live':'Menunggu'}</Pill></View><TrafficChart history={trafficHistory}/><View style={styles.trafficFooter}><View><Text style={styles.cardSubtitle}>Download</Text><Text style={styles.rateValue}>{formatRate(d.traffic?.rx)}</Text></View><View><Text style={styles.cardSubtitle}>Upload</Text><Text style={[styles.rateValue,{color:C.purple}]}>{formatRate(d.traffic?.tx)}</Text></View></View></Card>
      <View style={styles.statsGrid}><StatCard label="CPU" value={d.cpuLoad===undefined?null:`${d.cpuLoad}%`} sub="Pemakaian router" icon="cpu" tone={C.green}/><StatCard label="Memory" value={d.memoryUsedPercent===undefined?null:`${d.memoryUsedPercent}%`} sub={d.freeMemory?`${d.freeMemory} tersedia`:''} icon="memory" tone={C.purple}/></View>
    </ScrollView>;
  };

  const pppScreen=()=>{
    if(pppView==='add')return <ScrollView contentContainerStyle={styles.pageContent} keyboardShouldPersistTaps="handled"><ScreenHeader title={pppEditId?'Edit Akun PPP':'Tambah Akun PPP'} subtitle="Perubahan disimpan langsung di MikroTik." right={<Pressable onPress={()=>{setPppEditId(null);setPppView('users');}}><Text style={styles.link}>Batal</Text></Pressable>}/><Card><Field label="USERNAME" value={pppForm.name} onChangeText={name=>setPppForm(current=>({...current,name}))} placeholder="Username pelanggan"/><Field label={pppEditId?'PASSWORD BARU (OPSIONAL)':'PASSWORD'} value={pppForm.password} onChangeText={password=>setPppForm(current=>({...current,password}))} placeholder={pppEditId?'Kosongkan jika tidak diubah':'Password PPP'} secure/><Dropdown label="SERVICE" value={pppForm.service} options={data.services.map(service=>({value:service.value,label:service.label.toUpperCase()}))} onChange={service=>setPppForm(current=>({...current,service}))}/><Dropdown label="PROFILE" value={pppForm.profile} options={data.profiles.map(profile=>({value:profile.name,label:profile.name}))} onChange={profile=>setPppForm(current=>({...current,profile}))} placeholder="Pilih profile"/>{!data.profiles.length?<Text style={styles.cardSubtitle}>Profile belum tersedia dari RouterOS.</Text>:null}<Field label="LOCAL ADDRESS (OPSIONAL)" value={pppForm.localAddress} onChangeText={localAddress=>setPppForm(current=>({...current,localAddress}))} placeholder="Isi hanya jika diperlukan"/><Field label="REMOTE ADDRESS (OPSIONAL)" value={pppForm.remoteAddress} onChangeText={remoteAddress=>setPppForm(current=>({...current,remoteAddress}))} placeholder="IP atau pool address"/><Field label="COMMENT (OPSIONAL)" value={pppForm.comment} onChangeText={comment=>setPppForm(current=>({...current,comment}))} placeholder="Catatan akun"/><Button title={saving?(pppEditId?'Menyimpan...':'Menambahkan...'):pppEditId?'Simpan Perubahan':'Simpan Akun'} disabled={saving||!data.profiles.length} onPress={savePpp}/></Card></ScrollView>;
    return <View style={styles.flex}><View style={styles.pageContent}><ScreenHeader title={pppView==='active'?'PPP Aktif':'PPP'} subtitle={pppView==='active'?'Koneksi online':'Daftar akun PPPoE'} right={pppView==='users'?<Pressable onPress={()=>setPppView('add')} style={styles.addButton}><Text style={styles.addButtonText}>+</Text></Pressable>:<Pressable onPress={()=>setPppView('users')}><Text style={styles.link}>Daftar akun</Text></Pressable>}/><View style={styles.searchBox}><AppIcon name="search" color={C.muted} size={15}/><TextInput value={search} onChangeText={setSearch} placeholder={pppView==='active'?'Cari user atau IP...':'Cari username...'} placeholderTextColor={C.muted} style={styles.searchInput}/></View>{pppView==='users'?<View style={styles.chipRow}><Chip label={`Semua (${data.secrets.length})`} selected={pppFilter==='all'} onPress={()=>setPppFilter('all')}/><Chip label={`Aktif (${data.active.length})`} selected={pppFilter==='active'} onPress={()=>setPppFilter('active')}/><Chip label={`Offline (${Math.max(0,data.secrets.length-data.active.length)})`} selected={pppFilter==='offline'} onPress={()=>setPppFilter('offline')}/></View>:null}</View><FlatList data={pppView==='active'?visibleActive:visibleSecrets} keyExtractor={(item,index)=>String(item['.id']||item.name||index)} contentContainerStyle={styles.listContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.blue}/>} renderItem={({item})=>{
      const active=pppView==='active'||activeNames.has(item.name);
      return <Card onPress={pppView==='users'?()=>showPppActions(item):undefined} style={styles.userCard}><View style={styles.userRow}><View style={[styles.userAvatar,{backgroundColor:active?`${C.blue}30`:`${C.purple}24`}]}><AppIcon name="user" color={active?C.cyan:C.purple} size={18}/></View><View style={{flex:1}}><View style={styles.rowBetween}><Text style={styles.cardTitle}>{item.name||'Tanpa username'}</Text><Pill tone={active?C.green:C.muted}>{active?'Online':'Offline'}</Pill></View><Text style={styles.cardSubtitle}>{pppView==='active'?(item.address||DASH):`Profil ${item.profile||DASH} · ${item.service||'pppoe'}`}</Text>{pppView==='active'?<Text style={styles.cardSubtitle}>Uptime {formatUptime(item.uptime)} · Caller {item['caller-id']||DASH}</Text>:null}</View></View><View style={styles.userFooter}><Text style={styles.cardSubtitle}>{pppView==='active'?'Koneksi PPP aktif':`Remote address ${item['remote-address']||DASH}`}</Text>{pppView==='active'?<Button title="Putuskan" kind="danger" compact onPress={()=>disconnectPpp(item)}/>:null}</View></Card>;
    }} ListEmptyComponent={<EmptyState title={loading?'Memuat akun...':pppView==='active'?'Tidak ada sesi aktif':'Akun belum tersedia'} detail={error||'Data akan tampil setelah berhasil dimuat dari MikroTik.'} loading={loading}/>} /></View>;
  };

  const hotspotScreen=()=>{
    if(hotspotView==='edit')return <ScrollView contentContainerStyle={styles.pageContent} keyboardShouldPersistTaps="handled"><ScreenHeader title="Edit Voucher Hotspot" subtitle="Perubahan disimpan langsung di MikroTik." right={<Pressable onPress={()=>setHotspotView('vouchers')}><Text style={styles.link}>Batal</Text></Pressable>}/><Card><Field label="USERNAME" value={hotspotEditForm.name} onChangeText={name=>setHotspotEditForm(current=>({...current,name}))} placeholder="Username voucher"/><Field label="PASSWORD BARU (OPSIONAL)" value={hotspotEditForm.password} onChangeText={password=>setHotspotEditForm(current=>({...current,password}))} placeholder="Kosongkan jika tidak diubah" secure/><Dropdown label="PROFILE" value={hotspotEditForm.profile} options={data.hotspotProfiles.map(profile=>({value:profile.name,label:profile.name}))} onChange={profile=>setHotspotEditForm(current=>({...current,profile}))}/><Field label="DURASI (OPSIONAL)" value={hotspotEditForm.duration} onChangeText={duration=>setHotspotEditForm(current=>({...current,duration}))} placeholder="Contoh: 1h, 1d"/><Field label="COMMENT (OPSIONAL)" value={hotspotEditForm.comment} onChangeText={comment=>setHotspotEditForm(current=>({...current,comment}))} placeholder="Catatan voucher"/><Button title={saving?'Menyimpan...':'Simpan Perubahan'} disabled={saving||!data.hotspotProfiles.length} onPress={saveVoucher}/></Card></ScrollView>;
    if(hotspotView==='generate')return <ScrollView contentContainerStyle={styles.pageContent} keyboardShouldPersistTaps="handled"><ScreenHeader title="Buat Voucher" subtitle="Voucher disimpan sebagai user Hotspot di MikroTik." right={<Pressable onPress={()=>setHotspotView('vouchers')}><Text style={styles.link}>Batal</Text></Pressable>}/><Card><Field label="JUMLAH VOUCHER" value={voucherForm.count} onChangeText={count=>setVoucherForm(current=>({...current,count}))} placeholder="Jumlah, maksimal 100" keyboardType="number-pad"/><Field label="DURASI" value={voucherForm.duration} onChangeText={duration=>setVoucherForm(current=>({...current,duration}))} placeholder="1h, 1d, 1w"/><Text style={styles.label}>PROFILE HOTSPOT</Text><View style={styles.optionList}>{data.hotspotProfiles.map(profile=><Chip key={profile['.id']||profile.name} label={profile.name} selected={voucherForm.profile===profile.name} onPress={()=>setVoucherForm(current=>({...current,profile:profile.name}))}/>)}</View>{!data.hotspotProfiles.length?<Text style={styles.cardSubtitle}>Profile Hotspot tidak tersedia pada router.</Text>:null}<Button title={saving?'Membuat voucher...':'Generate Voucher'} disabled={saving||!data.hotspotProfiles.length} onPress={generateVouchers}/></Card></ScrollView>;
    const list=hotspotView==='active'?data.hotspotActive:hotspotView==='profiles'?data.hotspotProfiles:data.hotspotUsers;
    return <View style={styles.flex}><ScrollView contentContainerStyle={styles.pageContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.blue}/> }><ScreenHeader title="Hotspot" subtitle="Voucher dan manajemen Hotspot" right={<Pressable onPress={()=>loadData('hotspot',true)}><Text style={styles.link}>Muat ulang</Text></Pressable>}/><View style={styles.chipRow}><Chip label={`Voucher (${data.hotspotUsers.length})`} selected={hotspotView==='vouchers'} tone={C.cyan} onPress={()=>setHotspotView('vouchers')}/><Chip label={`User Aktif (${data.hotspotActive.length})`} selected={hotspotView==='active'} tone={C.cyan} onPress={()=>setHotspotView('active')}/><Chip label="Setting" selected={hotspotView==='profiles'} tone={C.cyan} onPress={()=>setHotspotView('profiles')}/></View>{hotspotView==='vouchers'?<Card style={styles.voucherSummary}><View style={[styles.statGlyph,{backgroundColor:`${C.purple}28`}]}><AppIcon name="voucher" color={C.purple} size={16}/></View><View style={{flex:1}}><Text style={styles.cardTitle}>Total Voucher</Text><Text style={styles.statValue}>{data.hotspotUsers.length}</Text><Text style={styles.cardSubtitle}>data user Hotspot router</Text></View><Button title="Generate" compact onPress={()=>setHotspotView('generate')}/></Card>:null}{generatedVouchers.length&&hotspotView==='vouchers'?<Card><Text style={styles.cardTitle}>Voucher baru</Text>{generatedVouchers.map(item=><View key={item.name} style={styles.generatedRow}><Text style={styles.cardTitle}>{item.name}</Text><Text style={styles.cardSubtitle}>Password: {item.password} · {item['limit-uptime']}</Text></View>)}</Card>:null}<SectionTitle title={hotspotView==='vouchers'?'Daftar Voucher':hotspotView==='active'?'User Aktif':'Profile Hotspot'} action={hotspotView==='vouchers'?'Buat voucher':null} onAction={()=>setHotspotView('generate')}/>{list.map((item,index)=><Card key={item['.id']||item.name||item.user||index} onPress={hotspotView==='vouchers'?()=>showVoucherActions(item):undefined} style={styles.userCard}><View style={styles.userRow}><View style={[styles.userAvatar,{backgroundColor:`${hotspotView==='active'?C.green:C.cyan}22`}]}><AppIcon name={hotspotView==='active'?'user':hotspotView==='profiles'?'settings':'voucher'} color={hotspotView==='active'?C.green:C.cyan} size={17}/></View><View style={{flex:1}}><View style={styles.rowBetween}><Text style={styles.cardTitle}>{item.name||item.user||'Hotspot user'}</Text>{hotspotView!=='profiles'?<Pill tone={item.disabled==='true'?C.red:C.green}>{item.disabled==='true'?'Disabled':hotspotView==='active'?'Online':'Tersedia'}</Pill>:null}</View><Text style={styles.cardSubtitle}>{hotspotView==='active'?`${item.address||DASH} · ${item['mac-address']||DASH}`:hotspotView==='profiles'?`Rate ${item['rate-limit']||'unlimited'} · Shared ${item['shared-users']||'1'}`:`Profil ${item.profile||DASH} · Durasi ${item['limit-uptime']||DASH}`}</Text>{hotspotView==='active'?<Text style={styles.cardSubtitle}>Uptime {formatUptime(item.uptime)} · Server {item.server||DASH}</Text>:null}</View></View></Card>)}{!list.length?<EmptyState title={loading?'Memuat data...':hotspotView==='active'?'Tidak ada user aktif':hotspotView==='profiles'?'Profile belum tersedia':'Belum ada voucher'} detail={error||'Belum ada data yang dikirim router MikroTik.'} loading={loading}/>:null}</ScrollView></View>;
  };

  const routerScreen=()=>{
    const d=data.dashboard;
    return <ScrollView contentContainerStyle={styles.pageContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.blue}/> }><ScreenHeader title="Router" subtitle="Informasi MikroTik"/>{error?<Card style={styles.errorCard}><Text style={styles.errorText}>{error}</Text><Button title="Coba lagi" kind="secondary" onPress={refresh}/></Card>:null}<Card style={styles.routerSummary}><View style={styles.routerMark}><AppIcon name="router" color={C.cyan} size={25}/></View><View style={{flex:1}}><Text style={styles.routerName}>{d.identity||routers[0]?.name||DASH}</Text><Text style={styles.cardSubtitle}>{routers[0]?.host||DASH}</Text><Text style={styles.cardSubtitle}>RouterOS {d.version||DASH}</Text></View><Pill tone={d.identity?C.green:C.muted}>{d.identity?'Online':'Status'}</Pill></Card><Card><SectionTitle title="Perangkat"/><Text style={styles.cardTitle}>{d.boardName||DASH}</Text><Text style={styles.cardSubtitle}>Arsitektur {d.architecture||DASH}</Text></Card><View style={styles.statsGrid}><StatCard label="CPU" value={d.cpuLoad===undefined?null:`${d.cpuLoad}%`} tone={C.green} icon="cpu"/><StatCard label="Memory" value={d.memoryUsedPercent===undefined?null:`${d.memoryUsedPercent}%`} sub={d.freeMemory?`${d.freeMemory} free`:''} tone={C.purple} icon="memory"/><StatCard label="Uptime" value={d.uptime} tone={C.blue} compactValue icon="clock" compactValue/><StatCard label="Interface" value={d.totalInterfaces} sub="terdeteksi" tone={C.cyan} icon="interface"/></View><Card><SectionTitle title="Interface" action="Muat ulang" onAction={refresh}/>{data.interfaces.map((item,index)=><Pressable accessibilityRole="button" accessibilityLabel={`Detail interface ${item.name||index+1}`} key={item['.id']||item.name||index} onPress={()=>setDetailItem({type:'interface',item})} style={styles.interfaceRow}><View style={[styles.interfaceMark,{backgroundColor:item.running==='true'?`${C.green}22`:`${C.muted}20`}]}><AppIcon name="interface" color={item.running==='true'?C.green:C.muted} size={16}/></View><View style={{flex:1}}><Text style={styles.cardTitle}>{item.name||`Interface ${index+1}`}</Text><Text style={styles.cardSubtitle}>{item.type||'interface'} · {item.running==='true'?'Connected':'Disabled'}</Text></View><View style={[styles.onlineDot,{backgroundColor:item.running==='true'?C.green:C.muted}]}/></Pressable>)}{!data.interfaces.length?<EmptyState title="Interface belum tersedia" detail={error||'Interface router akan muncul di sini.'} loading={loading}/>:null}</Card><Card style={styles.trafficFooterCard}><Text style={styles.cardTitle}>Traffic</Text><View style={styles.trafficFooter}><View><Text style={styles.cardSubtitle}>RX / Download</Text><Text style={styles.rateValue}>{formatRate(d.traffic?.rx)}</Text></View><View><Text style={styles.cardSubtitle}>TX / Upload</Text><Text style={[styles.rateValue,{color:C.purple}]}>{formatRate(d.traffic?.tx)}</Text></View></View></Card></ScrollView>;
  };

  const showSettingInfo=(title,message)=>Alert.alert(title,message);
  const settingsScreen=()=> <ScrollView contentContainerStyle={styles.pageContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.blue}/> }><ScreenHeader title="Pengaturan"/><Card style={styles.settingMenuCard}><SettingItem icon="router" title="Koneksi Router" subtitle={routers[0]?`● Terhubung langsung · ${routers[0].host}`:'Aplikasi berkomunikasi langsung dengan MikroTik'} tone={C.green} onPress={()=>loadData('settings',true)}/><SettingItem icon="router" title="Router" subtitle={routers[0]?`${data.dashboard.identity||routers[0].name} · ${routers[0].host}`:'Belum dikonfigurasi'} tone={C.cyan} onPress={openConnection}/><SettingItem icon="theme" title="Tema" subtitle="Dark Mode" tone={C.purple} onPress={()=>showSettingInfo('Tema','Dark Mode aktif.')}/><SettingItem icon="bell" title="Notifikasi" subtitle={notificationsEnabled?'Aktif':'Nonaktif'} tone={C.amber} onPress={()=>setNotificationsEnabled(value=>!value)}/><SettingItem icon="logout" title="Disconnect Router" subtitle="Hapus koneksi router tersimpan" tone={C.red} onPress={disconnectRouter}/><SettingItem icon="info" title="Tentang Aplikasi" subtitle="NetWatch Mon v1.0.0" tone={C.cyan} last onPress={()=>showSettingInfo('Tentang Aplikasi','Mikhmon Native v1.0.0 · Pengelolaan MikroTik.')}/></Card><View style={{paddingVertical:14,alignItems:'center'}}><Text style={styles.hostingBadge}>Powered by Aveum Edge Technologies</Text></View></ScrollView>;

  if(!routerReady)return <SafeAreaView style={[styles.safe,styles.center]}><ActivityIndicator color={C.blue}/><Text style={styles.screenSubtitle}>Memuat koneksi lokal...</Text></SafeAreaView>;
  if(routerStage)return <ConnectionScreen form={routerForm} setForm={setRouterForm} error={error} busy={routerBusy} onConnect={connectRouter}/>;
  const activeTab=tab;
  const screen=tab==='home'?dashboardScreen():tab==='ppp'?pppScreen():tab==='hotspot'?hotspotScreen():tab==='router'?routerScreen():settingsScreen();
  const detailPopup=detailItem?<RecordDetailPopup record={detailItem} onClose={()=>setDetailItem(null)} onEdit={()=>{const record=detailItem;setDetailItem(null);if(record.type==='ppp')editPpp(record.item);else editVoucher(record.item);}} onDelete={()=>{const record=detailItem;setDetailItem(null);if(record.type==='ppp')removePpp(record.item);else removeVoucher(record.item);}} onToggleInterface={toggleInterface} interfaceBusy={interfaceBusy}/>:null;
  return <View style={[styles.webViewport,{flex:1,minHeight:0}]}><SafeAreaView style={[styles.safe,{flex:1,minHeight:0}]}><ExpoStatusBar style="light"/><StatusBar barStyle="light-content" backgroundColor={C.bg}/><View style={styles.brandHeader}><View style={styles.logo}><Text style={styles.logoText}>M</Text></View><View style={{flex:1}}><Text style={styles.brand}>NetWatch Mon</Text><Text style={styles.brandSubtitle}>MikroTik Management</Text></View><Pressable onPress={()=>setTab('settings')} style={styles.notificationButton}><AppIcon name="bell" color={C.cyan} size={19}/></Pressable></View><View style={styles.flex}>{screen}{detailPopup}</View><View style={[styles.bottomTabs,{height:68,paddingTop:7}]}>{TABS.map(item=>{const selected=activeTab===item.id,tone=item.id==='hotspot'?C.cyan:C.blue,raised=item.id==='hotspot';return <Pressable key={item.id} onPress={()=>{setTab(item.id);setSearch('');}} style={[styles.tabItem,raised&&{transform:[{translateY:-4}]}]}><TabGlyph name={item.icon} active={selected} tone={tone} raised={raised}/><Text style={[styles.tabLabel,{color:selected?tone:C.muted}]}>{item.label}</Text></Pressable>;})}</View></SafeAreaView></View>;
}

function formatRate(value){if(value===null||value===undefined||!Number.isFinite(Number(value)))return DASH;const bits=Number(value);if(bits>=1000000)return `${(bits/1000000).toFixed(1)} Mbps`;if(bits>=1000)return `${(bits/1000).toFixed(0)} Kbps`;return `${bits.toFixed(0)} bps`;}
function formatUptime(value){
  if(value===null||value===undefined||value==='')return DASH;
  const raw=String(value).trim();
  const parts={w:0,d:0,h:0,m:0,s:0};
  const matches=[...raw.matchAll(/(\d+)([wdhms])/gi)];
  if(matches.length&&matches.map(match=>match[0]).join('')===raw.replace(/\s+/g,'')){
    for(const [,amount,unit] of matches)parts[unit.toLowerCase()]=Number(amount);
    const totalDays=parts.w*7+parts.d;
    const pad=n=>String(n).padStart(2,'0');
    return `${pad(totalDays)}:${pad(parts.h)}:${pad(parts.m)}:${pad(parts.s)}`;
  }
  return raw;
}

const styles=StyleSheet.create({
  webViewport:{height:'100%',width:'100%',maxWidth:430,alignSelf:'center'},safe:{height:'100%',backgroundColor:C.bg},flex:{flex:1,minHeight:0},center:{alignItems:'center',justifyContent:'center'},brandHeader:{height:68,flexShrink:0,paddingHorizontal:17,flexDirection:'row',alignItems:'center',gap:11,borderBottomWidth:1,borderBottomColor:C.line},logo:{width:36,height:36,borderRadius:11,backgroundColor:C.blue,alignItems:'center',justifyContent:'center'},logoText:{color:'#fff',fontWeight:'900',fontSize:21},brand:{color:C.text,fontSize:15,fontWeight:'900'},brandSubtitle:{color:C.muted,fontSize:9,letterSpacing:.5,marginTop:2},notificationButton:{width:34,height:34,borderRadius:11,alignItems:'center',justifyContent:'center',backgroundColor:C.panel2},pageContent:{padding:15,paddingBottom:24},screenHeader:{flexDirection:'row',alignItems:'center',gap:10,marginBottom:14},screenTitle:{color:C.text,fontSize:21,fontWeight:'900',letterSpacing:-.3},screenSubtitle:{color:C.muted,fontSize:11,marginTop:3,lineHeight:16},overline:{color:C.cyan,fontSize:10,fontWeight:'900',letterSpacing:1.4,marginBottom:6},card:{backgroundColor:C.panel,borderColor:C.line,borderWidth:1,borderRadius:16,padding:13,marginBottom:10},settingMenuCard:{padding:0,overflow:'hidden'},settingMenuItem:{minHeight:58,flexDirection:'row',alignItems:'center',gap:11,paddingHorizontal:12,paddingVertical:8},settingMenuDivider:{borderBottomWidth:1,borderBottomColor:C.line},settingMenuIcon:{width:34,height:34,borderRadius:12,alignItems:'center',justifyContent:'center'},hostingCard:{minHeight:86,flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:10,backgroundColor:'#09172d'},hostingIcon:{width:36,height:36,borderRadius:13,backgroundColor:'#211949',alignItems:'center',justifyContent:'center'},hostingBadge:{width:'100%',fontSize:8,color:C.muted,textAlign:'center',marginTop:2},routerSummary:{flexDirection:'row',alignItems:'center',gap:10,padding:12},routerMark:{width:43,height:43,borderRadius:13,backgroundColor:'#102c50',alignItems:'center',justifyContent:'center'},routerStatus:{color:C.green,fontSize:12,fontWeight:'900'},routerName:{color:C.text,fontSize:13,fontWeight:'800',marginTop:3},routerMeta:{color:C.muted,fontSize:9,marginTop:3},tag:{backgroundColor:C.panel2,color:C.text,fontSize:9,paddingHorizontal:7,paddingVertical:5,borderRadius:7,overflow:'hidden'},inline:{flexDirection:'row',alignItems:'center',gap:6},onlineDot:{width:7,height:7,borderRadius:5,backgroundColor:C.green},statsGrid:{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',gap:8,marginBottom:10},statCard:{width:'48%',minHeight:104,backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:14,padding:11},statValueCompact:{fontSize:15,letterSpacing:1.5,flexShrink:1},statGlyph:{width:25,height:25,borderRadius:8,alignItems:'center',justifyContent:'center',marginBottom:7},statLabel:{color:C.muted,fontSize:10},statValueCompact:{fontSize:17,letterSpacing:1},statValueCompact:{fontSize:15,letterSpacing:1.5,flexShrink:1},statValue:{color:C.text,fontSize:21,fontWeight:'900',marginTop:2},statSub:{color:C.muted,fontSize:9,marginTop:1},pill:{flexDirection:'row',alignItems:'center',gap:4,borderWidth:1,borderRadius:20,paddingHorizontal:7,paddingVertical:4},pillDot:{width:5,height:5,borderRadius:4},pillText:{fontSize:9,fontWeight:'800'},trafficCard:{padding:12},rowBetween:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},cardTitle:{color:C.text,fontSize:12,fontWeight:'800'},cardSubtitle:{color:C.muted,fontSize:9,marginTop:3,lineHeight:14},chartWrap:{height:132,flexDirection:'row',marginTop:10,marginBottom:7},chartPlot:{flex:1,height:'100%',minWidth:0},chartAxis:{width:46,justifyContent:'space-between',paddingVertical:2},axisRow:{flex:1,flexDirection:'row',alignItems:'center'},axisLabel:{width:41,color:C.muted,fontSize:7},axisLine:{height:1,flex:1,backgroundColor:'#17345e55'},axisBaseline:{backgroundColor:'#52698a'},chart:{height:132,flex:1,position:'relative',overflow:'hidden',justifyContent:'center'},chartGrid:{position:'absolute',left:0,right:0,height:1,backgroundColor:'#142c4e'},chartLine:{height:2,position:'absolute',transformOrigin:'left center'},chartEmpty:{color:C.muted,fontSize:10,textAlign:'center'},trafficFooter:{flexDirection:'row',justifyContent:'space-between',marginTop:7},rateValue:{color:C.cyan,fontSize:13,fontWeight:'900',marginTop:2},errorCard:{borderColor:'#743447',backgroundColor:'#251222'},errorTitle:{color:C.red,fontSize:12,fontWeight:'900',marginBottom:4},errorText:{color:'#f5bec8',fontSize:11,lineHeight:16,marginBottom:9},button:{minHeight:40,paddingHorizontal:14,paddingVertical:10,borderRadius:11,backgroundColor:C.blue,alignItems:'center',justifyContent:'center',marginTop:3},secondaryButton:{backgroundColor:C.panel2,borderColor:C.line,borderWidth:1},dangerButton:{backgroundColor:'#38182a',borderColor:'#7a2e49',borderWidth:1},compactButton:{minHeight:30,paddingVertical:6,paddingHorizontal:10,marginTop:0},buttonText:{color:'#fff',fontSize:11,fontWeight:'900'},disabled:{opacity:.45},searchBox:{height:40,flexDirection:'row',alignItems:'center',gap:8,backgroundColor:C.panel,borderColor:C.line,borderWidth:1,borderRadius:20,paddingHorizontal:12,marginBottom:9},searchInput:{flex:1,color:C.text,fontSize:11,paddingVertical:0},chipRow:{flexDirection:'row',flexWrap:'wrap',gap:6,marginBottom:10},chip:{borderRadius:20,borderWidth:1,borderColor:C.line,backgroundColor:C.panel2,paddingHorizontal:10,paddingVertical:7},chipText:{color:C.muted,fontSize:9,fontWeight:'700'},selectedChipText:{color:'#fff'},userCard:{padding:11,marginBottom:8},userRow:{flexDirection:'row',alignItems:'center',gap:9},userAvatar:{width:34,height:34,borderRadius:12,alignItems:'center',justifyContent:'center'},userFooter:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderTopWidth:1,borderTopColor:C.line,marginTop:9,paddingTop:8,gap:8},sectionHeading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:9},sectionTitle:{color:C.text,fontSize:13,fontWeight:'900'},link:{color:C.cyan,fontSize:10,fontWeight:'800'},addButton:{width:34,height:34,borderRadius:11,backgroundColor:C.blue,alignItems:'center',justifyContent:'center'},addButtonText:{color:'#fff',fontSize:23,fontWeight:'500',lineHeight:26},listContent:{paddingHorizontal:15,paddingBottom:24},emptyState:{alignItems:'center',justifyContent:'center',padding:26},emptyGlyph:{width:36,height:36,borderRadius:12,backgroundColor:C.panel2,alignItems:'center',justifyContent:'center'},emptyTitle:{color:C.text,fontSize:12,fontWeight:'900',marginTop:9},emptyDetail:{color:C.muted,fontSize:10,textAlign:'center',marginTop:4,lineHeight:15},field:{marginBottom:11},label:{color:C.muted,fontSize:9,fontWeight:'900',letterSpacing:.5,marginBottom:6},input:{minHeight:40,backgroundColor:'#061226',borderWidth:1,borderColor:C.line,borderRadius:10,color:C.text,paddingHorizontal:11,paddingVertical:9,fontSize:11},multilineInput:{minHeight:70,paddingTop:10},optionList:{flexDirection:'row',flexWrap:'wrap',gap:6,marginBottom:12},voucherSummary:{flexDirection:'row',alignItems:'center',gap:10},generatedRow:{borderTopWidth:1,borderTopColor:C.line,paddingTop:8,marginTop:8},interfaceRow:{flexDirection:'row',alignItems:'center',paddingVertical:9,borderTopWidth:1,borderTopColor:C.line,gap:9},interfaceMark:{width:29,height:29,borderRadius:9,alignItems:'center',justifyContent:'center'},trafficFooterCard:{marginBottom:20},settingRow:{flexDirection:'row',alignItems:'center',gap:9,marginVertical:8},settingIcon:{width:32,height:32,borderRadius:10,backgroundColor:C.panel2,alignItems:'center',justifyContent:'center'},bottomTabs:{height:62,flexShrink:0,flexDirection:'row',backgroundColor:'#061226',borderTopWidth:1,borderTopColor:C.line,paddingTop:5,paddingBottom:Platform.OS==='ios'?8:4},tabItem:{flex:1,alignItems:'center',justifyContent:'center',gap:2},tabGlyph:{width:29,height:24,alignItems:'center',justifyContent:'center'},tabLabel:{fontSize:8,fontWeight:'700'},pageContentFlex:{flex:1},dropdownFieldOpen:{zIndex:20,elevation:20},dropdown:{minHeight:42,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8,backgroundColor:'#061226',borderWidth:1,borderColor:C.line,borderRadius:10,paddingHorizontal:11},dropdownValue:{flex:1,color:C.text,fontSize:11,fontWeight:'700'},dropdownPlaceholder:{color:C.muted,fontWeight:'400'},dropdownOptions:{position:'absolute',left:0,right:0,bottom:51,maxHeight:190,zIndex:30,elevation:30,backgroundColor:'#061226',borderWidth:1,borderColor:C.line,borderRadius:10},dropdownOption:{minHeight:38,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:11,borderBottomWidth:1,borderBottomColor:'#17345e'},dropdownOptionSelected:{backgroundColor:'#102c50'},dropdownOptionText:{color:C.text,fontSize:11},dropdownOptionTextSelected:{color:C.cyan,fontWeight:'800'},dropdownEmpty:{color:C.muted,fontSize:10,padding:12}
});
const detailStyles=StyleSheet.create({
  overlay:{...StyleSheet.absoluteFillObject,backgroundColor:'#020817cc',alignItems:'center',justifyContent:'center',padding:20,zIndex:50,elevation:50},
  popup:{width:'100%',maxWidth:360,backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:18,padding:16},
  header:{flexDirection:'row',alignItems:'flex-start',gap:10,borderBottomWidth:1,borderBottomColor:C.line,paddingBottom:12},
  heading:{color:C.muted,fontSize:10,fontWeight:'800'},name:{color:C.text,fontSize:16,fontWeight:'900',marginTop:4},
  close:{width:32,height:32,alignItems:'center',justifyContent:'center',marginTop:-5,marginRight:-5},
  info:{paddingTop:8},detailLine:{minHeight:31,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},
  detailLabel:{color:C.muted,fontSize:10,flex:1},detailValue:{color:C.text,fontSize:10,fontWeight:'700',flex:1,textAlign:'right'},
  actions:{flexDirection:'row',justifyContent:'flex-end',gap:18,borderTopWidth:1,borderTopColor:C.line,marginTop:10,paddingTop:12},
  interfaceActions:{flexDirection:'row',gap:10,borderTopWidth:1,borderTopColor:C.line,marginTop:10,paddingTop:12},interfaceAction:{flex:1,minHeight:40,borderRadius:11,alignItems:'center',justifyContent:'center'},enableAction:{backgroundColor:C.blue},disableAction:{backgroundColor:'#38182a',borderWidth:1,borderColor:'#7a2e49'},interfaceActionText:{color:'#fff',fontSize:11,fontWeight:'900'},actionDisabled:{opacity:.45},
  action:{width:40,height:38,alignItems:'center',justifyContent:'center'}
});
