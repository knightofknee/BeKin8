// components/ItemMenu.tsx
import React from "react";
import { View, Modal, Pressable, Text, StyleSheet } from "react-native";
import { useTheme } from "../providers/ThemeProvider";
import { tap, warning } from "../utils/haptics";

type Props = {
  visible: boolean;
  onClose: () => void;
  onReport: () => void;
  onBlock?: () => void;
  showBlock?: boolean;
};

export default function ItemMenu({ visible, onClose, onReport, onBlock, showBlock = true }: Props) {
  const { colors } = useTheme();
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.backdrop }]} onPress={() => { tap(); onClose(); }}>
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <Pressable style={styles.row} onPress={() => { warning(); onReport(); onClose(); }}>
            <Text style={[styles.text, { color: colors.text }]}>Report</Text>
          </Pressable>
          {showBlock && onBlock && (
            <Pressable style={styles.row} onPress={() => { warning(); onBlock(); onClose(); }}>
              <Text style={[styles.text, { color: colors.text }]}>Block user</Text>
            </Pressable>
          )}
          <Pressable style={[styles.row, styles.cancel, { borderTopColor: colors.border }]} onPress={() => { tap(); onClose(); }}>
            <Text style={[styles.text, { color: colors.text }]}>Cancel</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
const styles = StyleSheet.create({
  backdrop:{ flex:1, backgroundColor:"#0008", justifyContent:"flex-end" },
  sheet:{ backgroundColor:"#1c1c1e", padding:12, borderTopLeftRadius:16, borderTopRightRadius:16 },
  row:{ paddingVertical:14 },
  cancel:{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor:"#333" },
  text:{ color:"#fff", fontSize:16 }
});
