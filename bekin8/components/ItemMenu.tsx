// components/ItemMenu.tsx
import React from "react";
import { View, Modal, Pressable, Text, StyleSheet } from "react-native";

type Props = {
  visible: boolean;
  onClose: () => void;
  onReport: () => void;
  onBlock?: () => void;
  showBlock?: boolean;
};

export default function ItemMenu({ visible, onClose, onReport, onBlock, showBlock = true }: Props) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.sheet}>
          <Pressable style={styles.row} onPress={() => { onReport(); onClose(); }}>
            <Text style={styles.text}>Report</Text>
          </Pressable>
          {showBlock && onBlock && (
            <Pressable style={styles.row} onPress={() => { onBlock(); onClose(); }}>
              <Text style={styles.text}>Block user</Text>
            </Pressable>
          )}
          <Pressable style={[styles.row, styles.cancel]} onPress={onClose}>
            <Text style={styles.text}>Cancel</Text>
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
